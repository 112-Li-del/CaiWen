import { defaultSchema } from "rehype-sanitize";

// Clean untrusted HTML before KaTeX generates its own trusted markup.
// Only code-fence classes used by math, syntax highlighting and Mermaid survive.
export const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ["className", /^language-[\w+-]+$/, "math-inline", "math-display"],
    ],
  },
};
