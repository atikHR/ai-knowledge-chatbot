import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App.jsx";
import { askQuestion, getDocuments, uploadDocument } from "./api.js";

vi.mock("./api.js", () => ({
  askQuestion: vi.fn(),
  getDocuments: vi.fn(),
  uploadDocument: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getDocuments.mockResolvedValue([]);
});

describe("knowledge workspace", () => {
  it("loads and displays the document library", async () => {
    getDocuments.mockResolvedValue([
      {
        id: "doc-1",
        filename: "bangladesh.pdf",
        status: "ready",
        created_at: "2026-10-05T00:00:00Z",
      },
    ]);

    render(<App />);

    expect(await screen.findByText("bangladesh.pdf")).toBeInTheDocument();
    expect(screen.getByLabelText("1 documents")).toBeInTheDocument();
  });

  it("sends a question and renders the grounded answer with its source", async () => {
    askQuestion.mockResolvedValue({
      answer: "Bangladesh is located in South Asia.",
      sources: [
        {
          filename: "bangladesh.pdf",
          page_number: 1,
          similarity: 0.91,
        },
      ],
    });
    const user = userEvent.setup();

    render(<App />);
    await user.type(
      screen.getByLabelText("Ask a question about your documents"),
      "Where is Bangladesh?",
    );
    await user.click(screen.getByRole("button", { name: "Send question" }));

    expect(askQuestion).toHaveBeenCalledWith("Where is Bangladesh?");
    expect(
      await screen.findByText("Bangladesh is located in South Asia."),
    ).toBeInTheDocument();
    expect(screen.getByText("Page 1")).toBeInTheDocument();
  });

  it("keeps the composer locked while a request is active", async () => {
    let resolveQuestion;
    askQuestion.mockReturnValue(
      new Promise((resolve) => {
        resolveQuestion = resolve;
      }),
    );
    const user = userEvent.setup();

    render(<App />);
    const input = screen.getByLabelText("Ask a question about your documents");
    await user.type(input, "What is in the guide?");
    await user.click(screen.getByRole("button", { name: "Send question" }));

    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();

    resolveQuestion({ answer: "The answer", sources: [] });
    expect(await screen.findByText("The answer")).toBeInTheDocument();
  });

  it("shows a provider error without removing the conversation", async () => {
    askQuestion.mockRejectedValue(
      new Error("The AI service is temporarily busy. Please try again shortly."),
    );
    const user = userEvent.setup();

    render(<App />);
    await user.type(
      screen.getByLabelText("Ask a question about your documents"),
      "Try this question",
    );
    await user.click(screen.getByRole("button", { name: "Send question" }));

    expect(
      await screen.findByText(
        "The AI service is temporarily busy. Please try again shortly.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Try this question")).toBeInTheDocument();
  });

  it("uploads a PDF and refreshes the document library", async () => {
    getDocuments
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "doc-2", filename: "new-guide.pdf", status: "ready" },
      ]);
    uploadDocument.mockResolvedValue({
      filename: "new-guide.pdf",
      chunk_count: 4,
    });
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("No documents yet");
    const file = new File(["pdf data"], "new-guide.pdf", {
      type: "application/pdf",
    });
    await user.upload(screen.getByLabelText("Choose PDF to upload"), file);

    expect(uploadDocument).toHaveBeenCalledWith(file);
    expect(
      await screen.findByText("new-guide.pdf is ready with 4 searchable chunks."),
    ).toBeInTheDocument();
    expect(await screen.findByText("new-guide.pdf")).toBeInTheDocument();
    await waitFor(() => expect(getDocuments).toHaveBeenCalledTimes(2));
  });
});
