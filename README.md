# AI Knowledge Chatbot

A full-stack retrieval-augmented generation (RAG) workspace. Upload PDF documents, search their embedded content in Supabase, and ask grounded questions through a responsive React interface.

## Architecture

```text
React + Vite
    |
FastAPI
    |
Gemini embeddings -> Supabase pgvector search -> Gemini answer generation
```

The browser talks only to FastAPI. Gemini and Supabase credentials stay in the backend environment and must never be exposed to the frontend.

## Prerequisites

- Node.js 20 or newer
- Python 3.11
- A Supabase project with the existing `documents`, `document_chunks`, and `match_document_chunks` setup
- A Gemini API key

## Backend setup

```bash
cd backend
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Fill in `backend/.env`:

```dotenv
GEMINI_API_KEY=your_new_gemini_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your_new_supabase_secret_key
FRONTEND_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Start the API:

```bash
uvicorn main:app --reload
```

FastAPI is available at `http://127.0.0.1:8000`, with interactive documentation at `http://127.0.0.1:8000/docs`.

## Frontend setup

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

The workspace is available at `http://localhost:5173`.

`VITE_API_URL` can point the frontend at a different backend. It is not a secret and is compiled into the browser bundle.

## Tests

Run the backend suite:

```bash
cd backend
source venv/bin/activate
python -m unittest discover -s tests -v
```

Run frontend tests and the production build:

```bash
cd frontend
npm test
npm run build
```

External Gemini and Supabase calls are mocked in automated tests, so tests do not consume API quota or modify production data.

## API

- `GET /health` — API health check
- `GET /documents` — list uploaded documents
- `POST /documents/upload` — upload and process a PDF using multipart field `file`
- `POST /search` — return matching document chunks
- `POST /chat` — generate a grounded answer from `{ "question": "..." }`

## Security notice

This repository previously tracked `backend/.env` and the Python virtual environment. Treat the old Gemini and Supabase keys as exposed: rotate both credentials in their provider dashboards before pushing or deploying. The repository history must also be replaced with the verified clean history before the next push.
