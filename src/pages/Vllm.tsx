import { useEffect, useRef, useState } from "react";
import { Alert, Button, Stack, TextField, Typography } from "@mui/material";
import api from "../services/api";
import { logout } from "../services/auth";
import { ChatAccessError, generate, type Message } from "../vllm/client";
export default function Vllm() {
  const [signedOut, setSignedOut] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [thinking, setThinking] = useState(false);
  const current = useRef<AbortController | null>(null);
  const stop = () => {
    current.current?.abort();
    current.current = null;
    setBusy(false);
    setThinking(false);
  };
  const loseAccess = () => {
    setAllowed(false);
    stop();
    setInput("");
    setMessages([]);
    setError("");
  };
  useEffect(() => {
    let active = true;
    const check = () =>
      api
        .get("access/")
        .then(({ data }) => {
          if (!active) return;
          const granted = data.services?.vllm?.enabled === true;
          setAllowed(granted);
          if (!granted) {
            loseAccess();
          }
        })
        .catch(() => {
          if (active) {
            loseAccess();
          }
        });
    void check();
    const timer = setInterval(() => void check(), 15000);
    return () => {
      active = false;
      clearInterval(timer);
      current.current?.abort();
    };
  }, []);
  const send = async () => {
    if (!allowed || busy || !input.trim()) return;
    const controller = new AbortController();
    current.current = controller;
    const next: Message[] = [
      ...messages.filter((message) => message.complete !== false),
      { role: "user", content: input },
    ];
    setMessages([...next, { role: "assistant", content: "", complete: false }]);
    setInput("");
    setBusy(true);
    setError("");
    try {
      await generate(
        next,
        controller.signal,
        (text) => {
          if (current.current !== controller) return;
          setMessages((old) =>
            old.map((message, index) =>
              index === old.length - 1
                ? { ...message, content: message.content + text }
                : message,
            ),
          );
        },
        () => {
          if (current.current === controller) setThinking(true);
        },
      );
      if (current.current === controller)
        setMessages((old) =>
          old.map((message, index) =>
            index === old.length - 1 ? { ...message, complete: true } : message,
          ),
        );
    } catch (error) {
      if (error instanceof ChatAccessError && current.current === controller) {
        loseAccess();
        return;
      }
      if (!controller.signal.aborted && current.current === controller)
        setError(
          error instanceof Error
            ? error.message
            : "Chat unavailable. Try again later.",
        );
    } finally {
      if (current.current === controller) {
        current.current = null;
        setBusy(false);
        setThinking(false);
      }
    }
  };
  if (signedOut) return <Typography role="status">Signing out…</Typography>;
  return (
    <Stack spacing={2}>
      <Button
        onClick={() => {
          loseAccess();
          setSignedOut(true);
          void Promise.resolve(logout()).finally(() =>
            window.location.assign("/login"),
          );
        }}
      >
        Log out
      </Button>
      {!allowed && <Alert severity="warning">AI chat access required</Alert>}
      {thinking && <Typography role="status">Thinking…</Typography>}
      {error && <Alert severity="error">{error}</Alert>}
      <Stack role="log" aria-label="Conversation" spacing={2}>
        {messages.map((message, i) => (
          <Typography
            key={i}
            sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          >
            {message.role}: {message.content}
            {message.complete === false && !busy
              ? " (interrupted — excluded from context)"
              : ""}
          </Typography>
        ))}
      </Stack>
      <TextField
        label="Message"
        multiline
        value={input}
        disabled={!allowed || busy}
        onChange={(event) => setInput(event.target.value)}
        inputProps={{ maxLength: 16000 }}
      />
      <Button
        disabled={!allowed || busy || !input.trim()}
        onClick={() => void send()}
      >
        Send
      </Button>
      <Button disabled={!busy} onClick={stop}>
        Stop
      </Button>
    </Stack>
  );
}
