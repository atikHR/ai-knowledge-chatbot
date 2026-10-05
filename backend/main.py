import os

from llm_service import generate_answer
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from google.genai.errors import ClientError, ServerError
from pydantic import BaseModel
from db import supabase
from pdf_service import extract_text_from_pdf
from chunk_service import chunk_text
from embedding_service import (
    generate_document_embedding,
    generate_query_embedding
)

app = FastAPI(
    title="AI Knowledge Chatbot API",
    version="1.0.0"
)

frontend_origins = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SearchRequest(BaseModel):
    question: str


class ChatRequest(BaseModel):
    question: str

@app.get("/")
def root():
    return {
        "message": "AI Knowledge Chatbot Backend"
    }


@app.get("/health")
def health():
    return {
        "status": "ok"
    }


@app.get("/documents")
def get_documents():
    try:
        response = (
            supabase
            .table("documents")
            .select("*")
            .order("created_at", desc=True)
            .execute()
        )

        return {
            "documents": response.data
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )

@app.post("/documents/upload")
def upload_document(file: UploadFile = File(...)):

    if file.content_type != "application/pdf":
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are allowed"
        )

    document_id = None

    try:

        # 1. Create document record
        document_response = (
            supabase
            .table("documents")
            .insert({
                "filename": file.filename,
                "file_type": "pdf",
                "status": "processing"
            })
            .execute()
        )

        document = document_response.data[0]
        document_id = document["id"]

        # 2. Extract text page by page
        pages = extract_text_from_pdf(file.file)

        chunk_records = []

        chunk_index = 0

        # 3. Chunk each page
        for page in pages:

            page_number = page["page_number"]
            page_text = page["text"]

            if not page_text.strip():
                continue

            chunks = chunk_text(page_text)

            for chunk in chunks:

                embedding = generate_document_embedding(
                    text=chunk,
                    title=file.filename
                )

                chunk_records.append({
                    "document_id": document_id,
                    "content": chunk,
                    "page_number": page_number,
                    "chunk_index": chunk_index,
                    "embedding": embedding
                })

                chunk_index += 1

        # 4. Make sure text was actually extracted
        if not chunk_records:
            raise ValueError(
                "No extractable text was found in this PDF"
            )

        # 5. Save all chunks to Supabase
        (
            supabase
            .table("document_chunks")
            .insert(chunk_records)
            .execute()
        )

        # 6. Mark document as ready
        (
            supabase
            .table("documents")
            .update({
                "status": "ready"
            })
            .eq("id", document_id)
            .execute()
        )

        return {
            "message": "PDF processed successfully",
            "document_id": document_id,
            "filename": file.filename,
            "page_count": len(pages),
            "chunk_count": len(chunk_records)
        }

    except Exception as error:

        if document_id is not None:
            (
                supabase
                .table("documents")
                .update({
                    "status": "failed"
                })
                .eq("id", document_id)
                .execute()
            )

        raise HTTPException(
            status_code=500,
            detail=str(error)
        )
@app.post("/search")
def search_knowledge(request: SearchRequest):

    if not request.question.strip():
        raise HTTPException(
            status_code=400,
            detail="Question cannot be empty"
        )

    try:

        # 1. Convert user question into an embedding
        query_embedding = generate_query_embedding(
            request.question
        )

        # 2. Search Supabase for similar chunks
        response = (
            supabase
            .rpc(
                "match_document_chunks",
                {
                    "query_embedding": query_embedding,
                    "match_threshold": 0.0,
                    "match_count": 5
                }
            )
            .execute()
        )

        # 3. Return matching chunks
        return {
            "question": request.question,
            "matches": response.data
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )
@app.post("/chat")
def chat(request: ChatRequest):

    question = request.question.strip()

    if not question:
        raise HTTPException(
            status_code=400,
            detail="Question cannot be empty"
        )

    try:
        # 1. Convert the user's question into an embedding
        query_embedding = generate_query_embedding(question)

        # 2. Retrieve the best matching chunks
        search_response = (
            supabase
            .rpc(
                "match_document_chunks",
                {
                    "query_embedding": query_embedding,
                    "match_threshold": 0.0,
                    "match_count": 5
                }
            )
            .execute()
        )

        matches = search_response.data or []

        # 3. Nothing retrieved
        if not matches:
            return {
                "answer": "I couldn't find that information in the knowledge base.",
                "sources": []
            }

        # 4. Check how relevant the best result is
        best_similarity = matches[0]["similarity"]

        MIN_SIMILARITY = 0.40

        if best_similarity < MIN_SIMILARITY:
            return {
                "answer": "I couldn't find that information in the knowledge base.",
                "sources": []
            }

        # 5. Build context from retrieved chunks
        context_parts = []

        for match in matches:
            context_parts.append(
                f"""
Source: {match['filename']}
Page: {match['page_number']}

{match['content']}
"""
            )

        context = "\n\n---\n\n".join(context_parts)

        # 6. Ask Gemini to answer using ONLY the retrieved context
        answer = generate_answer(
            question=question,
            context=context
        )

        # 7. Prepare source information for the frontend
        sources = []

        for match in matches:
            sources.append({
                "filename": match["filename"],
                "page_number": match["page_number"],
                "similarity": match["similarity"]
            })

        return {
            "answer": answer,
            "sources": sources
        }

    except ServerError as error:

        print("\n========== CHAT ERROR ==========")
        print(repr(error))
        print("================================\n")

        raise HTTPException(
            status_code=503,
            detail="The AI service is temporarily busy. Please try again shortly."
        ) from error

    except ClientError as error:

        print("\n========== CHAT ERROR ==========")
        print(repr(error))
        print("================================\n")

        if error.code == 429:
            raise HTTPException(
                status_code=429,
                detail="AI API usage limit reached. Please try again later."
            ) from error

        raise HTTPException(
            status_code=500,
            detail="An error occurred while generating the answer."
        ) from error

    except Exception as error:

        print("\n========== CHAT ERROR ==========")
        print(repr(error))
        print("================================\n")

        raise HTTPException(
            status_code=500,
            detail="An error occurred while generating the answer."
        ) from error
