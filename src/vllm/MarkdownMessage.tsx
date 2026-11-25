import { useState, isValidElement, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import "./chat.css";

export function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [status, setStatus] = useState("");
  return (
    <span className="copy-control">
      <button
        type="button"
        onClick={() => {
          void Promise.resolve()
            .then(() => navigator.clipboard.writeText(text))
            .then(
              () => setStatus("Copied"),
              () => setStatus("Copy failed"),
            );
        }}
      >
        {label}
      </button>
      <span role="status">{status}</span>
    </span>
  );
}
function CodeBlock({ children }: { children?: ReactNode }) {
  const props = isValidElement<{ children?: ReactNode; className?: string }>(
    children,
  )
    ? children.props
    : {};
  return (
    <div className="code-block">
      <div className="code-heading">
        <span>{props.className?.replace("language-", "") || "Code"}</span>
        <CopyButton
          text={String(props.children ?? "").replace(/\n$/, "")}
          label="Copy code"
        />
      </div>
      <pre>{children}</pre>
    </div>
  );
}
export default function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown-message">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [
            rehypeKatex,
            { trust: false, throwOnError: false, maxExpand: 1000, maxSize: 20 },
          ],
        ]}
        urlTransform={(url) =>
          /^(?:https?:|mailto:)/i.test(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url)
            ? url
            : ""
        }
        components={{
          img: ({ alt }) => <span>[Image: {alt || "image omitted"}]</span>,
          a: ({ href, children }) =>
            href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          pre: CodeBlock,
          table: ({ children }) => (
            <div className="table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
