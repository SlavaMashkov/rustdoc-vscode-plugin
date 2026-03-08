import { DocBlock } from "./docParser";

/**
 * Render all doc blocks in the file as a single HTML document.
 * Module-level //! blocks appear first, then item docs in source order.
 * Each block is wrapped in a <section> with an anchor ID for scroll-to.
 */
export function renderAllBlocksToHtml(blocks: DocBlock[]): string {
  if (blocks.length === 0) return "";

  const sections = blocks.map((block) => {
    const inner = renderDocToHtml(block);
    return `<section class="doc-section" id="doc-block-${block.startLine}">${inner}</section>`;
  });

  return sections.join('<hr class="section-divider">');
}

/**
 * Convert a single doc block to HTML.
 */
export function renderDocToHtml(block: DocBlock): string {
  const { content, refs } = extractReferenceLinks(block.lines);
  const markdown = content.join("\n");
  const html = markdownToHtml(markdown, refs);

  let headerHtml: string;
  if (block.isModuleDoc) {
    headerHtml = '<div class="module-header">Module Documentation</div>';
  } else if (block.signature) {
    headerHtml = `<div class="signature"><code>${escapeHtml(block.signature)}</code></div>`;
  } else {
    headerHtml = "";
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
      // Normalize label: lowercase, strip backticks
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownToHtml(md: string, refs: RefMap): string {
  const lines = md.split("\n");
  const output: string[] = [];
  let i = 0;
  let inList = false;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        const codeLine = lines[i];
        // Rustdoc hidden lines: lines starting with `# ` are hidden from output
        // A bare `#` on its own line is also hidden
        if (codeLine === "#" || codeLine.startsWith("# ")) {
          i++;
          continue;
        }
        codeLines.push(codeLine);
        i++;
      }
      i++; // skip closing ```
      if (inList) {
        output.push("</ul>");
        inList = false;
      }
      const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      output.push(
        `<pre><code${langClass}>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
      );
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (inList) {
        output.push("</ul>");
        inList = false;
      }
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
      if (inList) {
        output.push("</ul>");
        inList = false;
      }
      i++;
      continue;
    }

    // Regular paragraph
    if (inList) {
      output.push("</ul>");
      inList = false;
    }
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

  if (inList) {
    output.push("</ul>");
  }

  return output.join("\n");
}

/**
 * Handle inline markdown: bold, italic, code, inline/reference links.
 *
 * Uses a tokenization approach: first split text into "html" tokens (already safe)
 * and "raw" tokens (need escaping + further processing). This avoids placeholder hacks.
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
    // Add raw text before this match
    if (match.index > lastIndex) {
      parts.push(processRawSegment(text.slice(lastIndex, match.index)));
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      // [`code`][label]
      const url = refs.get(normalizeLabel(match[2]));
      if (url) {
        parts.push(`<a href="${escapeHtml(url)}"><code>${escapeHtml(match[1])}</code></a>`);
      } else {
        parts.push(`<code>${escapeHtml(match[1])}</code>`);
      }
    } else if (match[3] !== undefined && match[4] !== undefined) {
      // [text][label]
      const url = refs.get(normalizeLabel(match[4]));
      if (url) {
        parts.push(`<a href="${escapeHtml(url)}">${formatLinkText(match[3])}</a>`);
      } else {
        parts.push(processRawSegment(match[0]));
      }
    } else if (match[5] !== undefined && match[6] !== undefined) {
      // [`code`](url)
      parts.push(`<a href="${escapeHtml(match[6])}"><code>${escapeHtml(match[5])}</code></a>`);
    } else if (match[7] !== undefined && match[8] !== undefined) {
      // [text](url)
      parts.push(`<a href="${escapeHtml(match[8])}">${formatLinkText(match[7])}</a>`);
    } else if (match[9] !== undefined) {
      // [`code`] shortcut
      const url = refs.get(normalizeLabel("`" + match[9] + "`"));
      if (url) {
        parts.push(`<a href="${escapeHtml(url)}"><code>${escapeHtml(match[9])}</code></a>`);
      } else {
        parts.push(`<code>${escapeHtml(match[9])}</code>`);
      }
    } else if (match[10] !== undefined) {
      // [text] shortcut
      const url = refs.get(normalizeLabel(match[10]));
      if (url) {
        parts.push(`<a href="${escapeHtml(url)}">${formatLinkText(match[10])}</a>`);
      } else {
        parts.push(processRawSegment(match[0]));
      }
    } else if (match[11] !== undefined) {
      // `code`
      parts.push(`<code>${escapeHtml(match[11])}</code>`);
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining raw text
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
