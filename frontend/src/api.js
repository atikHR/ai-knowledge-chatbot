const API_URL = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

async function readResponse(response) {
  let data = null;

  try {
    data = await response.json();
  } catch {
    // A useful fallback is returned below when the server has no JSON body.
  }

  if (!response.ok) {
    throw new Error(data?.detail || "The request could not be completed.");
  }

  return data;
}

export async function getDocuments() {
  const response = await fetch(`${API_URL}/documents`);
  const data = await readResponse(response);
  return data?.documents || [];
}

export async function askQuestion(question) {
  const response = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question }),
  });

  return readResponse(response);
}

export async function uploadDocument(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_URL}/documents/upload`, {
    method: "POST",
    body: formData,
  });

  return readResponse(response);
}
