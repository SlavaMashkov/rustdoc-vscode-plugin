import { DocBlock } from "./docParser";

/**
 * Convert doc block lines to HTML.
 * Handles rustdoc markdown: headings, code blocks, paragraphs, lists,
 * bold, italic, links, and reference-style links.
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

/** Handle inline markdown: bold, italic, code, inline/reference links */
function inlineMarkdown(text: string, refs: RefMap): string {
  let result = escapeHtml(text);

  // Inline code (do first to protect code spans from further processing)
  // We'll use a placeholder approach to protect code spans
  const codeSpans: string[] = [];
  result = result.replace(/`([^`]+)`/g, (_match, code) => {
    const idx = codeSpans.length;
    codeSpans.push(`<code>${code}</code>`);
    return `\x00CODE${idx}\x00`;
  });

  // Bold (before italic)
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Italic
  result = result.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Inline links [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2">$1</a>',
  );

  // Reference links [text][label]
  result = result.replace(/\[([^\]]+)\]\[([^\]]+)\]/g, (_match, text, label) => {
    const url = refs.get(normalizeLabel(label));
    if (url) {
      return `<a href="${escapeHtml(url)}">${text}</a>`;
    }
    return `[${text}][${label}]`;
  });

  // Shortcut reference links [`name`] or [name]
  // Match [`code`] first (with backticks inside brackets)
  result = result.replace(/\[`([^`]+)`\]/g, (_match, name) => {
    const url = refs.get(normalizeLabel("`" + name + "`"));
    if (url) {
      return `<a href="${escapeHtml(url)}"><code>${escapeHtml(name)}</code></a>`;
    }
    // No ref found — just render as code
    return `<code>${escapeHtml(name)}</code>`;
  });

  // Shortcut reference links [name] (without backticks)
  result = result.replace(/\[([^\]]+)\]/g, (_match, name) => {
    // Skip if it looks like it was already processed (contains HTML)
    if (name.includes("<")) return `[${name}]`;
    const url = refs.get(normalizeLabel(name));
    if (url) {
      return `<a href="${escapeHtml(url)}">${name}</a>`;
    }
    return `[${name}]`;
  });

  // Restore code spans
  result = result.replace(/\x00CODE(\d+)\x00/g, (_match, idx) => {
    return codeSpans[parseInt(idx, 10)];
  });

  return result;
}
