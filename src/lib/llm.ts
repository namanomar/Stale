import { StaleError } from "./errors";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: { mime: string; base64: string }[];
}

export type JsonLlm = <T>(req: {
  name: string;
  schema: Record<string, unknown>;
  messages: ChatMessage[];
}) => Promise<T>;

let override: JsonLlm | null = null;
/** Tests inject a deterministic model here. */
export function setLlmForTests(fn: JsonLlm | null) {
  override = fn;
}

export function llmEnabled() {
  return !!override || !!process.env.OPENAI_API_KEY;
}

function toOpenAi(m: ChatMessage) {
  if (!m.images?.length) return { role: m.role, content: m.content };
  return {
    role: m.role,
    content: [
      { type: "text", text: m.content },
      ...m.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.base64}` } })),
    ],
  };
}

/** One structured-output call. The schema is enforced by the API (strict mode). */
export const chatJSON: JsonLlm = async <T,>(req: Parameters<JsonLlm>[0]) => {
  if (override) return override<T>(req);
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new StaleError(503, "OPENAI_API_KEY is not set");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
      temperature: 0,
      messages: req.messages.map(toOpenAi),
      response_format: { type: "json_schema", json_schema: { name: req.name, strict: true, schema: req.schema } },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new StaleError(502, `OpenAI: ${json?.error?.message ?? res.statusText}`);
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new StaleError(502, "OpenAI returned no content");
  return JSON.parse(text) as T;
};

/** Speech to text for voice notes and call recordings. */
export async function transcribe(file: { name: string; mime: string; bytes: Uint8Array }): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new StaleError(503, "OPENAI_API_KEY is not set; audio needs it");
  const form = new FormData();
  form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1");
  form.append("file", new Blob([file.bytes as BlobPart], { type: file.mime }), file.name);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new StaleError(502, `OpenAI: ${json?.error?.message ?? res.statusText}`);
  return String(json.text ?? "");
}
