"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import FallbackPreview from "./FallbackPreview";

/**
 * Renders a .docx file as formatted HTML using mammoth.js in the browser.
 *
 * Mammoth converts OOXML to clean HTML with paragraph, heading, list, table,
 * and inline-formatting support. The library is loaded lazily via Next.js
 * dynamic() in the parent, so it doesn't bloat the initial bundle.
 */
export default function DocxPreview({
  filename,
  url,
}: {
  filename: string;
  url: string | null;
}) {
  const { t } = useTranslation();
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      setError("No URL available");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const mammoth = await import("mammoth");

        const resp = await fetch(url, { credentials: "include" });
        if (!resp.ok) {
          throw new Error(`Failed to fetch document (${resp.status})`);
        }

        const arrayBuffer = await resp.arrayBuffer();
        const result = await mammoth.convertToHtml(
          { arrayBuffer },
          {
            // Convert images to inline data URIs so they render without
            // needing the original file server.
            convertImage: mammoth.images.dataUri,
          },
        );

        if (cancelled) return;

        if (result.messages.length > 0) {
          const warnings = result.messages
            .filter((m) => m.type === "warning")
            .map((m) => m.message);
          if (warnings.length > 0) {
            console.warn("Mammoth conversion warnings:", warnings);
          }
        }

        setHtml(result.value);
      } catch (err: unknown) {
        if (cancelled) return;
        const msg =
          err instanceof Error ? err.message : "Unknown error converting document";
        console.error("DocxPreview error:", msg);
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  // No URL → fallback
  if (!url) {
    return <FallbackPreview filename={filename} url={null} reason="legacy" />;
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <Loader2
          size={32}
          strokeWidth={1.5}
          className="animate-spin text-[var(--muted-foreground)]"
        />
        <div>
          <div className="text-[13px] font-medium text-[var(--foreground)]">
            {t("Loading document…")}
          </div>
          <p className="mt-1 max-w-xs text-[11.5px] leading-relaxed text-[var(--muted-foreground)]">
            {t("Converting Word document to HTML for preview.")}
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || html === null) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-start gap-2 border-b border-[var(--border)] bg-[var(--muted)]/40 px-5 py-2.5 text-[11px] text-[var(--muted-foreground)]">
          <AlertTriangle size={13} strokeWidth={1.6} className="mt-px shrink-0" />
          <p>
            {t(
              "Could not render the document preview. You can still download the original file.",
            )}
          </p>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <FallbackPreview filename={filename} url={url} reason="unsupported" />
        </div>
      </div>
    );
  }

  // Rendered HTML
  return (
    <div className="flex h-full flex-col">
      <style>{`
        .docx-content h1 {
          font-size: 1.6em;
          font-weight: 700;
          margin: 0.8em 0 0.4em;
          color: var(--foreground);
        }
        .docx-content h2 {
          font-size: 1.35em;
          font-weight: 600;
          margin: 0.7em 0 0.35em;
          color: var(--foreground);
        }
        .docx-content h3 {
          font-size: 1.15em;
          font-weight: 600;
          margin: 0.6em 0 0.3em;
          color: var(--foreground);
        }
        .docx-content h4,
        .docx-content h5,
        .docx-content h6 {
          font-size: 1em;
          font-weight: 600;
          margin: 0.5em 0 0.25em;
          color: var(--foreground);
        }
        .docx-content p {
          margin: 0.35em 0;
          line-height: 1.65;
          font-size: 13px;
          color: var(--foreground);
        }
        .docx-content ul,
        .docx-content ol {
          margin: 0.35em 0;
          padding-left: 1.5em;
          font-size: 13px;
          line-height: 1.65;
          color: var(--foreground);
        }
        .docx-content li {
          margin: 0.15em 0;
        }
        .docx-content ul li {
          list-style-type: disc;
        }
        .docx-content ol li {
          list-style-type: decimal;
        }
        .docx-content table {
          width: 100%;
          border-collapse: collapse;
          margin: 0.5em 0;
          font-size: 12.5px;
        }
        .docx-content th,
        .docx-content td {
          border: 1px solid var(--border);
          padding: 4px 8px;
          text-align: left;
          vertical-align: top;
        }
        .docx-content th {
          background: var(--muted);
          font-weight: 600;
        }
        .docx-content img {
          max-width: 100%;
          height: auto;
          margin: 0.5em 0;
        }
        .docx-content strong,
        .docx-content b {
          font-weight: 600;
        }
        .docx-content em,
        .docx-content i {
          font-style: italic;
        }
        .docx-content u {
          text-decoration: underline;
        }
        .docx-content a {
          color: var(--primary);
          text-decoration: underline;
        }
        .docx-content blockquote {
          border-left: 3px solid var(--primary);
          padding-left: 1em;
          margin: 0.5em 0;
          color: var(--muted-foreground);
        }
        .docx-content pre {
          background: var(--muted);
          padding: 0.6em 1em;
          border-radius: 6px;
          overflow-x: auto;
          font-size: 12px;
          margin: 0.5em 0;
        }
        .docx-content code {
          background: var(--muted);
          padding: 0.15em 0.35em;
          border-radius: 3px;
          font-size: 0.9em;
        }
        .docx-content pre code {
          background: none;
          padding: 0;
        }
        .docx-content hr {
          border: none;
          border-top: 1px solid var(--border);
          margin: 1em 0;
        }
      `}</style>
      <div
        className="docx-content flex-1 overflow-y-auto px-6 py-5"
        // Sandbox the Word HTML so it inherits theme variables without
        // being able to break the page layout.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
