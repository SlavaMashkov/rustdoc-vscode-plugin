import { DocBlock } from "./docParser";

/**
 * Convert doc block lines to HTML.
 * Handles basic markdown: headings, code blocks, paragraphs, lists, bold, italic, links.
 */
export function renderDocToHtml(block: DocBlock): string {
  const markdown = block.lines.join("\n");
  const html = markdownToHtml(markdown);

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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownToHtml(md: string): string {
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
      // Render as h3-h6 (offset by 2 since these are subsections)
      const tag = `h${Math.min(level + 2, 6)}`;
      output.push(`<${tag}>${inlineMarkdown(headingMatch[2])}</${tag}>`);
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
      output.push(`<li>${inlineMarkdown(listMatch[2])}</li>`);
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
    output.push(`<p>${inlineMarkdown(paraLines.join(" "))}</p>`);
  }

  if (inList) {
    output.push("</ul>");
  }

  return output.join("\n");
}

/** Handle inline markdown: bold, italic, code, links */
function inlineMarkdown(text: string): string {
  let result = escapeHtml(text);
  // Inline code
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Bold
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Italic
  result = result.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  // Links [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2">$1</a>',
  );
  return result;
}
