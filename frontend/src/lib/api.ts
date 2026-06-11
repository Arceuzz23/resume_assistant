// src/lib/api.ts

const API_BASE = "http://localhost:8000";

export interface AssistantResponse {
  answer: string;
  confidence: number;
  source: "resume" | "inference";
  missing_data: string[];
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "error";
  text?: string;
  data?: AssistantResponse;
}

export const api = {
  async uploadResume(file: File): Promise<{ session_id: string }> {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE}/upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) throw new Error(`Upload failed: ${response.statusText}`);
    return response.json();
  },

  async chat(sessionId: string, query: string, model: string): Promise<AssistantResponse> {
    const response = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, query, model }),
    });

    if (!response.ok) throw new Error(`Chat failed: ${response.statusText}`);
    return response.json();
  }
};