import os
import sys
import unittest
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

os.environ.setdefault("GEMINI_API_KEY", "test-gemini-key")
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_SECRET_KEY", "test-supabase-key")

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import HTTPException, UploadFile
from fastapi.testclient import TestClient
from google.genai.errors import ClientError, ServerError
from starlette.datastructures import Headers

import main


def make_server_error():
    return ServerError(
        503,
        {
            "error": {
                "code": 503,
                "message": "busy",
                "status": "UNAVAILABLE",
            }
        },
    )


def make_client_error():
    return ClientError(
        429,
        {
            "error": {
                "code": 429,
                "message": "quota",
                "status": "RESOURCE_EXHAUSTED",
            }
        },
    )


class ChatTests(unittest.TestCase):
    def test_empty_question_returns_400(self):
        with self.assertRaises(HTTPException) as context:
            main.chat(main.ChatRequest(question="   "))

        self.assertEqual(context.exception.status_code, 400)

    def test_relevant_match_returns_answer_and_sources(self):
        supabase = MagicMock()
        supabase.rpc.return_value.execute.return_value = SimpleNamespace(
            data=[
                {
                    "filename": "bangladesh.pdf",
                    "page_number": 1,
                    "content": "Bangladesh is in South Asia.",
                    "similarity": 0.91,
                }
            ]
        )

        with (
            patch.object(main, "supabase", supabase),
            patch.object(main, "generate_query_embedding", return_value=[0.1]),
            patch.object(
                main,
                "generate_answer",
                return_value="Bangladesh is located in South Asia.",
            ),
        ):
            response = main.chat(
                main.ChatRequest(question="Where is Bangladesh?")
            )

        self.assertEqual(response["answer"], "Bangladesh is located in South Asia.")
        self.assertEqual(response["sources"][0]["filename"], "bangladesh.pdf")
        self.assertEqual(response["sources"][0]["page_number"], 1)

    def test_irrelevant_match_returns_grounded_fallback(self):
        supabase = MagicMock()
        supabase.rpc.return_value.execute.return_value = SimpleNamespace(
            data=[
                {
                    "filename": "guide.pdf",
                    "page_number": 2,
                    "content": "Unrelated content",
                    "similarity": 0.2,
                }
            ]
        )

        with (
            patch.object(main, "supabase", supabase),
            patch.object(main, "generate_query_embedding", return_value=[0.1]),
        ):
            response = main.chat(main.ChatRequest(question="Repair a motorcycle"))

        self.assertEqual(response["sources"], [])
        self.assertIn("couldn't find", response["answer"])

    def test_provider_errors_map_to_public_status_codes(self):
        cases = ((make_server_error(), 503), (make_client_error(), 429))

        for provider_error, expected_status in cases:
            with self.subTest(expected_status=expected_status):
                with patch.object(
                    main,
                    "generate_query_embedding",
                    side_effect=provider_error,
                ):
                    with self.assertRaises(HTTPException) as context:
                        main.chat(main.ChatRequest(question="A question"))

                self.assertEqual(context.exception.status_code, expected_status)


class DocumentTests(unittest.TestCase):
    def test_document_list_returns_database_rows(self):
        documents = [
            {
                "id": "doc-1",
                "filename": "guide.pdf",
                "status": "ready",
            }
        ]
        supabase = MagicMock()
        supabase.table.return_value.select.return_value.order.return_value.execute.return_value = (
            SimpleNamespace(data=documents)
        )

        with patch.object(main, "supabase", supabase):
            response = main.get_documents()

        self.assertEqual(response, {"documents": documents})

    def test_pdf_upload_processes_and_persists_chunks(self):
        supabase = MagicMock()
        documents_table = MagicMock()
        chunks_table = MagicMock()
        supabase.table.side_effect = lambda name: (
            documents_table if name == "documents" else chunks_table
        )
        documents_table.insert.return_value.execute.return_value = SimpleNamespace(
            data=[{"id": "doc-1"}]
        )

        upload = UploadFile(
            file=BytesIO(b"%PDF-1.4"),
            filename="guide.pdf",
            headers=Headers({"content-type": "application/pdf"}),
        )

        with (
            patch.object(main, "supabase", supabase),
            patch.object(
                main,
                "extract_text_from_pdf",
                return_value=[{"page_number": 1, "text": "Useful knowledge"}],
            ),
            patch.object(main, "chunk_text", return_value=["Useful knowledge"]),
            patch.object(main, "generate_document_embedding", return_value=[0.1]),
        ):
            response = main.upload_document(upload)

        self.assertEqual(response["document_id"], "doc-1")
        self.assertEqual(response["chunk_count"], 1)
        chunks_table.insert.assert_called_once()
        documents_table.update.assert_called_with({"status": "ready"})

    def test_non_pdf_upload_returns_400(self):
        upload = UploadFile(
            file=BytesIO(b"plain text"),
            filename="notes.txt",
            headers=Headers({"content-type": "text/plain"}),
        )

        with self.assertRaises(HTTPException) as context:
            main.upload_document(upload)

        self.assertEqual(context.exception.status_code, 400)

    def test_failed_processing_marks_document_failed(self):
        supabase = MagicMock()
        documents_table = MagicMock()
        supabase.table.return_value = documents_table
        documents_table.insert.return_value.execute.return_value = SimpleNamespace(
            data=[{"id": "doc-1"}]
        )

        upload = UploadFile(
            file=BytesIO(b"%PDF-1.4"),
            filename="broken.pdf",
            headers=Headers({"content-type": "application/pdf"}),
        )

        with (
            patch.object(main, "supabase", supabase),
            patch.object(
                main,
                "extract_text_from_pdf",
                side_effect=ValueError("Unreadable PDF"),
            ),
        ):
            with self.assertRaises(HTTPException) as context:
                main.upload_document(upload)

        self.assertEqual(context.exception.status_code, 500)
        documents_table.update.assert_called_with({"status": "failed"})


class CorsTests(unittest.TestCase):
    def test_local_frontend_origin_is_allowed(self):
        client = TestClient(main.app)
        response = client.options(
            "/chat",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["access-control-allow-origin"],
            "http://localhost:5173",
        )


if __name__ == "__main__":
    unittest.main()
