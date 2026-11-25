import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Alert, Button, Stack, TextField, Typography } from "@mui/material";
import ThemeToggle from "../components/ThemeToggle";
import MarkdownMessage, { CopyButton } from "../vllm/MarkdownMessage";
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
  const scroll = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const answered = useRef(false);
  const [latest, setLatest] = useState(false);
  useLayoutEffect(() => {
    if (follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages, thinking, latest]);
  const current = useRef<AbortController | null>(null);
  const stop = useCallback(() => {
    current.current?.abort();
    current.current = null;
    setBusy(false);
    setThinking(false);
  }, []);
  const loseAccess = useCallback(() => {
    setAllowed(false);
    stop();
    setInput("");
    setMessages([]);
    setError("");
  }, [stop]);
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
  }, [loseAccess]);
  const send = async () => {
    if (!allowed || busy || !input.trim()) return;
    answered.current = false;
    follow.current = true;
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
          if (current.current !== controller || !text) return;
          answered.current = true;
          setThinking(false);
          setMessages((old) =>
            old.map((message, index) =>
              index === old.length - 1
                ? { ...message, content: message.content + text }
                : message,
            ),
          );
        },
        () => {
          if (current.current === controller && !answered.current)
            setThinking(true);
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
    <Stack className="chat" sx={{ height: "100%", minHeight: 0 }}>
      <header className="chat-header">
        <div>
          <strong>AI chat</strong>
          <span className="model-badge">qwen3-next</span>
        </div>
        <div className="header-actions">
          <Button
            onClick={() => {
              stop();
              setMessages([]);
              setInput("");
              setError("");
              follow.current = true;
              setLatest(false);
              requestAnimationFrame(() => composer.current?.focus());
            }}
          >
            New chat
          </Button>
          <ThemeToggle />
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
        </div>
      </header>
      <div
        className="conversation-scroll"
        ref={scroll}
        onScroll={() => {
          const node = scroll.current!;
          follow.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 96;
          setLatest(!follow.current);
        }}
      >
        <div className="conversation">
          {!allowed && (
            <Alert severity="warning">AI chat access required</Alert>
          )}
          {!messages.length && (
            <section className="welcome">
              <div className="welcome-mark">✦</div>
              <Typography variant="h4" component="h1">
                What can I help with?
              </Typography>
              <Typography color="text.secondary">
                A little clarity, a fresh idea, or a place to start.
              </Typography>
              <div className="prompt-chips">
                {[
                  "Explain a complex idea simply",
                  "Help me plan my week",
                  "Write a Python example",
                ].map((prompt) => (
                  <Button
                    variant="outlined"
                    key={prompt}
                    disabled={!allowed}
                    onClick={() => {
                      setInput(prompt);
                      composer.current?.focus();
                    }}
                  >
                    {prompt}
                  </Button>
                ))}
              </div>
            </section>
          )}
          <Stack
            role="log"
            aria-live="off"
            aria-label="Conversation"
            spacing={4}
          >
            {messages.map((message, i) => (
              <article key={i} className={`chat-message ${message.role}`}>
                <div className="message-label">
                  {message.role === "user" ? "You" : "Assistant"}
                </div>
                {message.role === "user" ? (
                  <div className="user-bubble">{message.content}</div>
                ) : (
                  <MarkdownMessage content={message.content} />
                )}
                {message.content && <CopyButton text={message.content} />}
                {message.complete === false && !busy && (
                  <Typography variant="caption">
                    Interrupted — excluded from context
                  </Typography>
                )}
              </article>
            ))}
          </Stack>
          <Typography role="status" className="generation-status">
            {busy
              ? thinking
                ? "Thinking…"
                : messages.at(-1)?.content
                  ? "Responding…"
                  : "Waiting…"
              : ""}
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
        </div>
      </div>
      <div className="composer-area">
        {latest && (
          <Button
            className="jump-latest"
            onClick={() => {
              follow.current = true;
              setLatest(false);
              scroll.current?.scrollTo({
                top: scroll.current.scrollHeight,
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                  .matches
                  ? "instant"
                  : "smooth",
              });
            }}
          >
            Jump to latest ↓
          </Button>
        )}
        <div className="composer-box">
          <TextField
            label="Message"
            InputLabelProps={{ shrink: true }}
            placeholder="Ask anything"
            multiline
            minRows={2}
            maxRows={8}
            fullWidth
            inputRef={composer}
            value={input}
            disabled={!allowed || busy}
            onChange={(event) => setInput(event.target.value)}
            inputProps={{ maxLength: 16000 }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229)
                return;
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="composer-footer">
            <Typography variant="caption" color="text.secondary">
              Shift + Enter for a new line
            </Typography>
            <Button
              variant="contained"
              disabled={!allowed || (!busy && !input.trim())}
              onClick={() => (busy ? stop() : void send())}
            >
              {busy ? "Stop" : "Send"}
            </Button>
          </div>
        </div>
        <Typography
          className="chat-note"
          variant="caption"
          color="text.secondary"
        >
          AI can make mistakes. Check important information.
        </Typography>
      </div>
    </Stack>
  );
}
