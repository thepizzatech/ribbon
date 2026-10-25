import { createServerFn } from "@tanstack/react-start";

const SYSTEM = [
  "You are the assistant inside Ribbon, a private family gift ledger.",
  "Answer using only the ledger JSON in the user message.",
  "Never invent people, gifts, dates, or amounts.",
  "If the ledger does not contain the answer, say you do not see it.",
  "Write plain sentences a household would understand.",
  "Use a short bullet list only when naming several gifts.",
  "Amounts are US dollars. Mention a dollar amount only when the ledger includes a number.",
  "Keep the reply under 160 words.",
  "Do not open with a greeting or with Sure.",
].join(" ");

type AskResult = { ok: true; text: string } | { ok: false; error: string };

function readOutput(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const record = body as {
    output_text?: unknown;
    output?: { type?: string; content?: { text?: unknown }[] }[];
  };
  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim();
  }
  if (!Array.isArray(record.output)) return "";
  const chunks: string[] = [];
  for (const item of record.output) {
    if (!item || item.type === "reasoning" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (typeof part?.text === "string") chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
}

async function callModel(apiKey: string, question: string, ledger: string, withReasoning: boolean) {
  const body: Record<string, unknown> = {
    model: "grok-4.5",
    max_output_tokens: 500,
    input: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Ledger JSON:\n${ledger}\n\nQuestion:\n${question}` },
    ],
  };
  if (withReasoning) body.reasoning = { effort: "low" };
  return fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
}

export const askLedger = createServerFn({ method: "POST" })
  .validator((input: unknown): { question: string; ledger: string } => {
    if (!input || typeof input !== "object") throw new Error("Invalid request");
    const question = (input as { question?: unknown }).question;
    const ledger = (input as { ledger?: unknown }).ledger;
    if (typeof question !== "string" || question.trim().length < 2 || question.length > 500) {
      throw new Error("Ask a short question.");
    }
    if (typeof ledger !== "string" || ledger.length < 2 || ledger.length > 24_000) {
      throw new Error("The ledger is too large to send.");
    }
    return { question: question.trim(), ledger };
  })
  .handler(async ({ data }): Promise<AskResult> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "The assistant isn’t available right now. Your ledger still works on this device." };

    try {
      let response = await callModel(apiKey, data.question, data.ledger, true);
      if (response.status === 400) response = await callModel(apiKey, data.question, data.ledger, false);
      if (!response.ok) {
        console.error("xAI request failed", response.status);
        return {
          ok: false,
          error:
            response.status === 429
              ? "The assistant is busy. Try again in a moment."
              : "The assistant couldn’t answer just now.",
        };
      }
      const body: unknown = await response.json();
      const text = readOutput(body);
      if (!text) return { ok: false, error: "The assistant returned an empty note. Try again." };
      return { ok: true, text };
    } catch (error) {
      console.error("xAI request error", error instanceof Error ? error.message : "unknown");
      return { ok: false, error: "The assistant couldn’t answer just now." };
    }
  });
