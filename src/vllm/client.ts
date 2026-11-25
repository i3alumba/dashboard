import { getAccessToken } from "../utils/cookies";
import { refreshAccessToken } from "../services/api";
export class ChatAccessError extends Error {}
export type Message = {
  role: "user" | "assistant";
  content: string;
  complete?: boolean;
};
export async function generate(
  messages: Message[],
  signal: AbortSignal,
  append: (text: string) => void,
  thinking: () => void = () => {},
) {
  const send = () =>
    fetch("/api/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAccessToken()}`,
      },
      body: JSON.stringify({
        model: "qwen3-next",
        messages: messages
          .filter((message) => message.complete !== false)
          .map(({ role, content }) => ({ role, content })),
        stream: true,
        max_tokens: 512,
      }),
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
  if (!response.ok || !response.body)
    throw new Error(`Chat unavailable (${response.status})`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let finalAnswer = false;
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
          return;
        }
        let delta;
        try {
          delta = JSON.parse(data).choices?.[0]?.delta;
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
