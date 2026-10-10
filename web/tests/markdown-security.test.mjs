import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { markdownSanitizeSchema } from "../lib/markdown-security.mjs";

function render(content, math = false) {
  return renderToStaticMarkup(React.createElement(ReactMarkdown, {
    children: content,
    remarkPlugins: math ? [remarkMath] : [],
    rehypePlugins: [rehypeRaw, [rehypeSanitize, markdownSanitizeSchema],
      ...(math ? [rehypeKatex] : [])],
  }));
}

test("stored HTML cannot introduce active elements or event attributes", () => {
  const html = render('<script>alert(1)</script><iframe srcdoc="<script>alert(1)</script>"></iframe><img src="/missing.png" onerror="alert(1)"><svg onload="alert(1)"></svg><form action="/api/v1/auth/logout"><input></form>');
  assert.doesNotMatch(html, /<script|<iframe|<svg|<form|onerror|onload|srcdoc/i);
});

test("dangerous links and DOM-clobbering IDs are neutralized", () => {
  const html = render('<a href="javascript:alert(1)">查看政策</a><a href="data:text/html,test">下载</a><p id="location">正文</p>');
  assert.doesNotMatch(html, /href="(?:javascript|data):|id="location"/i);
  assert.match(html, /正文/);
});

test("normal policy formatting, code and Mermaid fences survive", () => {
  const html = render('<details><summary>说明</summary><p>正文</p></details>\n\n<table><tr><td>政策</td></tr></table>\n\n```mermaid\ngraph TD; A-->B\n```\n\n```xml\n<script>alert(1)</script>\n```');
  assert.match(html, /<details>/);
  assert.match(html, /<table>/);
  assert.match(html, /language-mermaid/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("math still renders after sanitizing the untrusted source", () => {
  assert.match(render('$x^2$\n\n$$\nx+1\n$$', true), /class="katex/);
});
