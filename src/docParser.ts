import * as vscode from "vscode";

export interface DocBlock {
  startLine: number;
  endLine: number;
  /** Raw doc content lines (without leading `/// `) */
  lines: string[];
  /** The signature line right after the doc block (pub fn ..., pub struct ..., etc.) */
  signature: string | undefined;
}

const DOC_COMMENT_RE = /^(\s*)\/\/\/(.*)$/;
const SIGNATURE_RE = /^\s*(pub\s+)?(fn|struct|enum|trait|type|const|static|mod|impl|macro)\b/;

export function parseDocBlocks(document: vscode.TextDocument): DocBlock[] {
  const blocks: DocBlock[] = [];
  const lineCount = document.lineCount;
  let i = 0;

  while (i < lineCount) {
    const lineText = document.lineAt(i).text;
    const match = DOC_COMMENT_RE.exec(lineText);

    if (match) {
      const startLine = i;
      const docLines: string[] = [];

      while (i < lineCount) {
        const text = document.lineAt(i).text;
        const m = DOC_COMMENT_RE.exec(text);
        if (!m) break;
        const content = m[2].startsWith(" ") ? m[2].slice(1) : m[2];
        docLines.push(content);
        i++;
      }

      // Look for the signature line after doc block (skip blank lines and attributes)
      let signature: string | undefined;
      let j = i;
      while (j < lineCount) {
        const text = document.lineAt(j).text.trim();
        if (text === "" || text.startsWith("#[")) {
          j++;
          continue;
        }
        if (SIGNATURE_RE.test(text)) {
          // Collect multi-line signatures (e.g. generic bounds with `where`)
          let sig = text;
          // Clean up: remove trailing `{`, trim
          sig = sig.replace(/\s*\{\s*$/, "").trimEnd();
          signature = sig;
        }
        break;
      }

      blocks.push({
        startLine,
        endLine: i - 1,
        lines: docLines,
        signature,
      });
    } else {
      i++;
    }
  }

  return blocks;
}

/**
 * Find the doc block that contains or is closest above the given line.
 */
export function findDocBlockAtLine(
  blocks: DocBlock[],
  line: number,
): DocBlock | undefined {
  // Check if cursor is inside a doc block
  for (const block of blocks) {
    if (line >= block.startLine && line <= block.endLine) {
      return block;
    }
  }

  // Check if cursor is on the signature line (right after a doc block)
  for (const block of blocks) {
    // Within a few lines after the doc block (attributes, blank lines, signature)
    if (line > block.endLine && line <= block.endLine + 5) {
      return block;
    }
  }

  return undefined;
}
