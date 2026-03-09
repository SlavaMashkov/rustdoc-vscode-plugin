import hljs from "highlight.js/lib/core";
import rust from "highlight.js/lib/languages/rust";
import { DocBlock, FileSegment } from "./docParser";

hljs.registerLanguage("rust", rust);

/**
 * Render the entire file as interleaved code blocks and rendered doc HTML.
 * Each segment gets data-line-start/data-line-end attributes for scroll sync.
 */
export function renderFullFileToHtml(segments: FileSegment[]): string {
  if (segments.length === 0) return "";

  return segments
    .map((seg) => {
      if (seg.kind === "code") {
        const highlighted = highlightRust(seg.lines.join("\n"));
        const hLines = highlighted.split("\n");
        const lineSpans = hLines
          .map(
            (line, i) =>
              `<span data-line="${seg.startLine + i}" data-line-display="${seg.startLine + i + 1}">${line || " "}</span>`,
          )
          .join("");
        return `<pre class="code-segment" data-line-start="${seg.startLine}" data-line-end="${seg.endLine}">${lineSpans}</pre>`;
      } else {
        const inner = renderDocToHtml(seg.block);
        return `<div class="doc-segment" data-line-start="${seg.startLine}" data-line-end="${seg.endLine}">${inner}</div>`;
      }
    })
    .join("");
}

/**
 * Convert a single doc block to HTML.
 */
export function renderDocToHtml(block: DocBlock): string {
  const { content, refs } = extractReferenceLinks(block.lines);
  const markdown = content.join("\n");
  const html = markdownToHtml(markdown, refs);

  let headerHtml = "";
  if (block.isModuleDoc) {
    headerHtml = '<div class="module-header">Module Documentation</div>';
  }

  return headerHtml + html;
}

type RefMap = Map<string, string>;

const REF_DEFINITION_RE = /^\[([^\]]+)\]:\s+(.+)$/;

/**
 * Extract reference link definitions from the end of doc lines.
 * Returns content lines (without definitions) and a map of label -> url.
 */
function extractReferenceLinks(lines: string[]): {
  content: string[];
  refs: RefMap;
} {
  const refs: RefMap = new Map();
  const content: string[] = [];

  for (const line of lines) {
    const match = REF_DEFINITION_RE.exec(line.trim());
    if (match) {
      // Normalize label: lowercase, collapse whitespace
      const label = normalizeLabel(match[1]);
      refs.set(label, match[2].trim());
    } else {
      content.push(line);
    }
  }

  return { content, refs };
}

/** Normalize a reference label for matching: lowercase, collapse whitespace */
function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, " ").trim();
}

const RUSTDOC_URL_RE = /^((?:[a-zA-Z_][a-zA-Z0-9_]*[/])*)(?:struct|enum|trait|fn|type|const|static|mod|macro)[.]([^.]+)[.]html(?:#(?:(?:method|variant|tymethod|associatedtype|associatedconstant|impl)[.](.+)|[^#]*))?$/;

/**
 * Parse a rustdoc relative URL into a symbol path, or return null if not a rustdoc URL.
 * e.g. "fn.init.html" → "init"
 *      "struct.Builder.html#method.init" → "Builder::init"
 *      "fmt/struct.Formatter.html" → "fmt::Formatter"
 *      "struct.Env.html#default-environment-variables" → "Env" (section anchor ignored)
 */
function parseRustdocUrl(href: string): string | null {
  if (href.startsWith("http://") || href.startsWith("https://")) return null;

  // Anchor-only: #method.filter, #variant.Name, #tymethod.foo
  if (href.startsWith("#")) {
    const anchorMatch = /^#(?:method|variant|tymethod|associatedtype|associatedconstant|impl)[.](.+)$/.exec(href);
    if (anchorMatch) return anchorMatch[1];
    return null;
  }

  // Rust path syntax: std::io::Write, std::writeln
  if (/^[a-zA-Z_][a-zA-Z0-9_]*(?:::[a-zA-Z_][a-zA-Z0-9_]*)+$/.test(href)) {
    return href;
  }

  const m = RUSTDOC_URL_RE.exec(href);
  if (!m) return null;
  const modulePath = m[1] ? m[1].replace(/\//g, "::").replace(/::$/, "") : "";
  const typeName = m[2];
  const member = m[3];
  let result = typeName;
  if (member) result = typeName + "::" + member;
  if (modulePath) result = modulePath + "::" + result;
  return result;
}

/** Render a link — if href is a rustdoc relative URL, render as intra-doc; otherwise normal link */
function renderLink(href: string, innerHtml: string): string {
  const symbolPath = parseRustdocUrl(href);
  if (symbolPath) {
    return `<a class="intra-doc" data-path="${escapeHtml(symbolPath)}">${innerHtml}</a>`;
  }
  return `<a href="${escapeHtml(href)}">${innerHtml}</a>`;
}

function highlightRust(code: string): string {
  try {
    return hljs.highlight(code, { language: "rust" }).value;
  } catch (err) {
    console.warn("[rustdoc-viewer] Syntax highlighting failed:", err);
    return escapeHtml(code);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const RUST_CODE_BLOCK_LANGS = new Set([
  "", "rust", "rs", "no_run", "should_panic", "compile_fail", "ignore",
]);

function markdownToHtml(md: string, refs: RefMap): string {
  const lines = md.split("\n");
  const output: string[] = [];
  let i = 0;
  let inList = false;

  function closeList(): void {
    if (!inList) return;
    output.push("</ul>");
    inList = false;
  }

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        const codeLine = lines[i];
        // Rustdoc hidden lines: `# ` prefix or bare `#` are hidden from output
        if (codeLine === "#" || codeLine.startsWith("# ")) {
          i++;
          continue;
        }
        codeLines.push(codeLine);
        i++;
      }
      i++; // skip closing ```
      closeList();
      const codeText = codeLines.join("\n");
      const codeHtml = RUST_CODE_BLOCK_LANGS.has(lang) ? highlightRust(codeText) : escapeHtml(codeText);
      const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      output.push(`<pre><code${langClass}>${codeHtml}</code></pre>`);
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      const tag = `h${Math.min(level + 2, 6)}`;
      output.push(`<${tag}>${inlineMarkdown(headingMatch[2], refs)}</${tag}>`);
      i++;
      continue;
    }

    // List item
    const listMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (listMatch) {
      if (!inList) {
        output.push("<ul>");
        inList = true;
      }
      output.push(`<li>${inlineMarkdown(listMatch[2], refs)}</li>`);
      i++;
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      closeList();
      i++;
      continue;
    }

    // Regular paragraph
    closeList();
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("```") &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].match(/^\s*[-*]\s/)
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    output.push(`<p>${inlineMarkdown(paraLines.join(" "), refs)}</p>`);
  }

  closeList();
  return output.join("\n");
}

/** Render code text as inline `<code>`, optionally wrapped in a link. */
function renderCodeRef(code: string, url: string | undefined): string {
  const codeHtml = `<code>${escapeHtml(code)}</code>`;
  if (url) return renderLink(url, codeHtml);
  return codeHtml;
}

/** Render text as a reference link, falling back to an intra-doc link. */
function renderTextRef(text: string, label: string, url: string | undefined): string {
  const inner = formatLinkText(text);
  if (url) return renderLink(url, inner);
  return `<a class="intra-doc" data-path="${escapeHtml(label)}">${inner}</a>`;
}

/**
 * Handle inline markdown: bold, italic, code, inline/reference links.
 *
 * Uses a single-pass regex to match link forms and inline code, processing
 * unmatched text segments through HTML escaping and bold/italic formatting.
 */
function inlineMarkdown(text: string, refs: RefMap): string {
  // Combined regex that matches all link forms and inline code in one pass.
  // Order matters: longer/more specific patterns first.
  // Groups:
  //   1,2: [`code`][label]
  //   3,4: [text][label]
  //   5,6: [`code`](url)
  //   7,8: [text](url)
  //   9:   [`code`]  (shortcut)
  //   10:  [text]    (shortcut, no backticks)
  //   11:  `code`    (inline code, not in brackets)
  const COMBINED_RE =
    /\[`([^`]+)`\]\[([^\]]+)\]|\[([^\]]+)\]\[([^\]]+)\]|\[`([^`]+)`\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\[`([^`]+)`\]|\[([^\]]+)\]|`([^`]+)`/g;

  const parts: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = COMBINED_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(processRawSegment(text.slice(lastIndex, match.index)));
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      // [`code`][label]
      parts.push(renderCodeRef(match[1], refs.get(normalizeLabel(match[2]))));
    } else if (match[3] !== undefined && match[4] !== undefined) {
      // [text][label]
      parts.push(renderTextRef(match[3], match[4], refs.get(normalizeLabel(match[4]))));
    } else if (match[5] !== undefined && match[6] !== undefined) {
      // [`code`](url)
      parts.push(renderLink(match[6], `<code>${escapeHtml(match[5])}</code>`));
    } else if (match[7] !== undefined && match[8] !== undefined) {
      // [text](url)
      parts.push(renderLink(match[8], formatLinkText(match[7])));
    } else if (match[9] !== undefined) {
      // [`code`] shortcut — ref label includes backticks
      const url = refs.get(normalizeLabel("`" + match[9] + "`"));
      parts.push(url
        ? renderLink(url, `<code>${escapeHtml(match[9])}</code>`)
        : `<a class="intra-doc" data-path="${escapeHtml(match[9])}"><code>${escapeHtml(match[9])}</code></a>`);
    } else if (match[10] !== undefined) {
      // [text] shortcut
      parts.push(renderTextRef(match[10], match[10], refs.get(normalizeLabel(match[10]))));
    } else if (match[11] !== undefined) {
      // `code`
      parts.push(`<code>${escapeHtml(match[11])}</code>`);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(processRawSegment(text.slice(lastIndex)));
  }

  return parts.join("");
}

/** Format link text: escape HTML and render inline code/bold/italic within it */
function formatLinkText(text: string): string {
  // Handle backtick code spans within link text
  return escapeHtml(text).replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** Process a raw text segment: escape HTML, then apply bold/italic */
function processRawSegment(text: string): string {
  let result = escapeHtml(text);
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return result;
}
