import { getAccessToken } from "../utils/cookies";
import { refreshAccessToken } from "../services/api";
export class ChatAccessError extends Error {}
export type Message = {
  role: "user" | "assistant";
  content: string;
  complete?: boolean;
};
export type ContextUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};
function contextUsage(
  value: unknown,
  limit: number | null,
): ContextUsage | null {
  if (!value || typeof value !== "object" || limit !== 16384) return null;
  const usage = value as ContextUsage;
  const counts = [
    usage.prompt_tokens,
    usage.completion_tokens,
    usage.total_tokens,
  ];
  return counts.every((n) => Number.isSafeInteger(n) && n >= 0) &&
    usage.total_tokens === usage.prompt_tokens + usage.completion_tokens &&
    usage.total_tokens <= limit
    ? usage
    : null;
}
export async function generate(
  messages: Message[],
  signal: AbortSignal,
  append: (text: string) => void,
  thinking: () => void = () => {},
  onUsage: (usage: ContextUsage) => void | Promise<void> = () => {},
  contextLength: number | null = null,
) {
  const body = JSON.stringify({
    model: "qwen3-next",
    messages: messages
      .filter((message) => message.complete !== false)
      .map(({ role, content }) => ({ role, content })),
    stream: true,
    stream_options: { include_usage: true },
  });
  if (new TextEncoder().encode(body).byteLength > 1048576)
    throw new Error(
      "Conversation request exceeds 1 MiB. Start a new chat or shorten it.",
    );
  const send = () =>
    fetch("/api/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAccessToken()}`,
      },
      body,
    });
  let response = await send();
  if (response.status === 401) {
    try {
      await refreshAccessToken();
    } catch {
      throw new ChatAccessError("Chat authorization expired");
    }
    signal.throwIfAborted();
    response = await send();
  }
  if (response.status === 401 || response.status === 403)
    throw new ChatAccessError("Chat access unavailable");
  if (response.status === 400) {
    const data = await response.json().catch(() => null);
    throw new Error(
      typeof data?.error?.message === "string"
        ? data.error.message
        : "Conversation exceeds available context. Start a new chat or shorten it.",
    );
  }
  if (!response.ok || !response.body)
    throw new Error(`Chat unavailable (${response.status})`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let finalAnswer = false;
  let completedUsage: ContextUsage | null = null;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("Response interrupted before completion");
      pending += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end).trim();
        pending = pending.slice(end + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          if (!finalAnswer)
            throw new Error(
              "Thinking ended without a final answer. Try a shorter request.",
            );
          signal.throwIfAborted();
          if (completedUsage) await onUsage(completedUsage);
          return;
        }
        let delta;
        try {
          const chunk = JSON.parse(data);
          if (
            Array.isArray(chunk.choices) &&
            chunk.choices.length === 0 &&
            chunk.usage != null
          )
            completedUsage = contextUsage(chunk.usage, contextLength);
          delta = chunk.choices?.[0]?.delta;
        } catch {
          throw new Error("Invalid inference stream");
        }
        if (
          typeof delta?.reasoning_content === "string" &&
          delta.reasoning_content
        ) {
          signal.throwIfAborted();
          thinking();
        }
        const text = delta?.content;
        if (typeof text === "string") {
          signal.throwIfAborted();
          if (text) finalAnswer = true;
          append(text);
        }
      }
      if (pending.length > 1048576) throw new Error("Invalid stream");
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export async function verifiedContext(
  signal: AbortSignal,
): Promise<number | null> {
  const send = () =>
    fetch("/api/models", {
      signal,
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    });
  let response = await send();
  if (response.status === 401) {
    await refreshAccessToken();
    signal.throwIfAborted();
    response = await send();
  }
  if (!response.ok) return null;
  const body = await response.json();
  return (
    body.data?.find(
      (model: {
        id?: string;
        max_model_len?: number;
        output_budget?: string;
      }) =>
        model.id === "qwen3-next" &&
        model.max_model_len === 16384 &&
        model.output_budget === "remaining_context",
    )?.max_model_len ?? null
  );
}
