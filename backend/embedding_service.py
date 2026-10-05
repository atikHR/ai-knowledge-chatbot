import os

from dotenv import load_dotenv
from google import genai
from google.genai import types


load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY is missing from .env")


client = genai.Client(api_key=GEMINI_API_KEY)

EMBEDDING_MODEL = "gemini-embedding-2"
EMBEDDING_DIMENSION = 768


def generate_document_embedding(text: str, title: str = "none"):
    prepared_text = f"title: {title} | text: {text}"

    response = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=prepared_text,
        config=types.EmbedContentConfig(
            output_dimensionality=EMBEDDING_DIMENSION
        )
    )

    return response.embeddings[0].values


def generate_query_embedding(query: str):
    prepared_query = f"task: search result | query: {query}"

    response = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=prepared_query,
        config=types.EmbedContentConfig(
            output_dimensionality=EMBEDDING_DIMENSION
        )
    )

    return response.embeddings[0].values