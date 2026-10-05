import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  CheckCircle2,
  FileText,
  FolderOpen,
  Library,
  LoaderCircle,
  MessageSquareText,
  Plus,
  RefreshCw,
  Sparkles,
  UploadCloud,
  UserRound,
  X,
} from "lucide-react";

import { askQuestion, getDocuments, uploadDocument } from "./api.js";

const WELCOME_MESSAGE = {
  id: "welcome",
  role: "assistant",
  text: "Ask me anything about the documents in your knowledge base. I’ll answer from your sources and show you where the information came from.",
  sources: [],
};

function formatDate(value) {
  if (!value) return "Recently added";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently added";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function Alert({ children, onClose, tone = "error" }) {
  return (
    <div className={`alert alert--${tone}`} role="alert">
      <span>{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss message">
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function DocumentCard({ document }) {
  const ready = document.status === "ready";

  return (
    <li className="document-card">
      <span className="document-card__icon" aria-hidden="true">
        <FileText size={18} />
      </span>
      <span className="document-card__content">
        <strong title={document.filename}>{document.filename}</strong>
        <small>{formatDate(document.created_at)}</small>
      </span>
      <span
        className={`status-dot ${ready ? "status-dot--ready" : ""}`}
        title={document.status || "Unknown status"}
        aria-label={document.status || "Unknown status"}
      />
    </li>
  );
}

function SourceCard({ source }) {
  return (
    <div className="source-card">
      <FileText size={15} aria-hidden="true" />
      <span>{source.filename}</span>
      <strong>Page {source.page_number}</strong>
    </div>
  );
}

function Message({ message }) {
  const isAssistant = message.role === "assistant";

  return (
    <article className={`message message--${message.role}`}>
      <div className="message__avatar" aria-hidden="true">
        {isAssistant ? <Bot size={18} /> : <UserRound size={18} />}
      </div>
      <div className="message__body">
        <div className="message__meta">
          {isAssistant ? "Knowledge assistant" : "You"}
        </div>
        <p>{message.text}</p>
        {message.sources?.length > 0 && (
          <div className="message__sources" aria-label="Answer sources">
            {message.sources.map((source, index) => (
              <SourceCard
                key={`${source.filename}-${source.page_number}-${index}`}
                source={source}
              />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function App() {
  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState("");
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [question, setQuestion] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  const loadDocuments = useCallback(async () => {
    setDocumentsLoading(true);
    setDocumentsError("");

    try {
      setDocuments(await getDocuments());
    } catch (error) {
      setDocumentsError(error.message);
    } finally {
      setDocumentsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatLoading]);

  const sendQuestion = async (event) => {
    event.preventDefault();
    const cleanQuestion = question.trim();

    if (!cleanQuestion || chatLoading) return;

    setQuestion("");
    setChatError("");
    setChatLoading(true);
    setMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: "user",
        text: cleanQuestion,
        sources: [],
      },
    ]);

    try {
      const response = await askQuestion(cleanQuestion);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: response.answer,
          sources: response.sources || [],
        },
      ]);
    } catch (error) {
      setChatError(error.message);
    } finally {
      setChatLoading(false);
    }
  };

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || uploadLoading) return;

    const looksLikePdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

    if (!looksLikePdf) {
      setUploadSuccess("");
      setUploadError("Choose a PDF file to add to the knowledge base.");
      return;
    }

    setUploadLoading(true);
    setUploadError("");
    setUploadSuccess("");

    try {
      const result = await uploadDocument(file);
      setUploadSuccess(
        `${result.filename} is ready with ${result.chunk_count} searchable chunks.`,
      );
      await loadDocuments();
    } catch (error) {
      setUploadError(error.message);
    } finally {
      setUploadLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <Sparkles size={20} />
          </span>
          <span>
            <strong>Knowly</strong>
            <small>AI knowledge workspace</small>
          </span>
        </div>

        <section className="upload-card" aria-labelledby="upload-title">
          <span className="upload-card__icon" aria-hidden="true">
            {uploadLoading ? (
              <LoaderCircle className="spin" size={22} />
            ) : (
              <UploadCloud size={22} />
            )}
          </span>
          <div>
            <h2 id="upload-title">Add knowledge</h2>
            <p>Upload a PDF to make it searchable.</p>
          </div>
          <button
            type="button"
            className="button button--primary button--full"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadLoading}
          >
            <Plus size={16} aria-hidden="true" />
            {uploadLoading ? "Processing PDF…" : "Upload document"}
          </button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleUpload}
            aria-label="Choose PDF to upload"
          />
        </section>

        {uploadError && (
          <Alert onClose={() => setUploadError("")}>{uploadError}</Alert>
        )}
        {uploadSuccess && (
          <Alert tone="success" onClose={() => setUploadSuccess("")}>
            {uploadSuccess}
          </Alert>
        )}

        <section className="library" aria-labelledby="library-title">
          <div className="section-heading">
            <span>
              <Library size={17} aria-hidden="true" />
              <h2 id="library-title">Your library</h2>
            </span>
            <button
              type="button"
              onClick={loadDocuments}
              disabled={documentsLoading}
              aria-label="Refresh document library"
            >
              <RefreshCw
                className={documentsLoading ? "spin" : ""}
                size={15}
                aria-hidden="true"
              />
            </button>
          </div>

          {documentsError && (
            <Alert onClose={() => setDocumentsError("")}>{documentsError}</Alert>
          )}

          {!documentsError && documentsLoading && (
            <div className="library-state">
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
              Loading documents…
            </div>
          )}

          {!documentsError && !documentsLoading && documents.length === 0 && (
            <div className="library-empty">
              <FolderOpen size={28} aria-hidden="true" />
              <strong>No documents yet</strong>
              <span>Your uploaded PDFs will appear here.</span>
            </div>
          )}

          {!documentsLoading && documents.length > 0 && (
            <ul className="document-list">
              {documents.map((document) => (
                <DocumentCard key={document.id} document={document} />
              ))}
            </ul>
          )}
        </section>

        <div className="sidebar__footer">
          <span className="connection-dot" aria-hidden="true" />
          {documentsError ? "Backend unavailable" : "Knowledge base connected"}
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace__header">
          <div>
            <span className="eyebrow">
              <MessageSquareText size={14} aria-hidden="true" />
              Grounded answers
            </span>
            <h1>Chat with your documents</h1>
            <p>Every answer is generated from the knowledge you provide.</p>
          </div>
          <div className="document-count" aria-label={`${documents.length} documents`}>
            <FileText size={16} aria-hidden="true" />
            <strong>{documents.length}</strong>
            <span>{documents.length === 1 ? "document" : "documents"}</span>
          </div>
        </header>

        <section className="chat" aria-label="Knowledge base conversation">
          <div className="messages" aria-live="polite">
            {messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}

            {chatLoading && (
              <article className="message message--assistant">
                <div className="message__avatar" aria-hidden="true">
                  <Bot size={18} />
                </div>
                <div className="message__body message__body--loading">
                  <div className="message__meta">Knowledge assistant</div>
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="visually-hidden">Thinking</span>
                </div>
              </article>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="composer-wrap">
            {chatError && (
              <Alert onClose={() => setChatError("")}>{chatError}</Alert>
            )}
            <form className="composer" onSubmit={sendQuestion}>
              <label className="visually-hidden" htmlFor="question">
                Ask a question about your documents
              </label>
              <textarea
                id="question"
                rows="1"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="Ask a question about your documents…"
                disabled={chatLoading}
              />
              <button
                type="submit"
                className="send-button"
                disabled={chatLoading || !question.trim()}
                aria-label="Send question"
              >
                {chatLoading ? (
                  <LoaderCircle className="spin" size={19} aria-hidden="true" />
                ) : (
                  <ArrowUp size={19} aria-hidden="true" />
                )}
              </button>
            </form>
            <p className="composer-note">
              <CheckCircle2 size={13} aria-hidden="true" />
              Answers are limited to your uploaded knowledge base.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
