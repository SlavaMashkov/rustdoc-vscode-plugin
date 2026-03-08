import * as vscode from "vscode";

export interface DocBlock {
  startLine: number;
  endLine: number;
  /** Raw doc content lines (without leading `/// ` or `//! `) */
  lines: string[];
  /** The signature line right after the doc block (pub fn ..., pub struct ..., etc.) */
  signature: string | undefined;
  /** Whether this is a module-level `//!` doc comment */
  isModuleDoc: boolean;
}

const DOC_COMMENT_RE = /^(\s*)\/\/\/(.*)$/;
const MODULE_DOC_COMMENT_RE = /^(\s*)\/\/!(.*)$/;
const SIGNATURE_RE = /^\s*(pub\s+)?(fn|struct|enum|trait|type|const|static|mod|impl|macro)\b/;

export function parseDocBlocks(document: vscode.TextDocument): DocBlock[] {
  const blocks: DocBlock[] = [];
  const lineCount = document.lineCount;
  let i = 0;

  while (i < lineCount) {
    const lineText = document.lineAt(i).text;
    const moduleMatch = MODULE_DOC_COMMENT_RE.exec(lineText);
    const docMatch = DOC_COMMENT_RE.exec(lineText);

    if (moduleMatch) {
      // //! module-level doc comment block
      const startLine = i;
      const docLines: string[] = [];

      while (i < lineCount) {
        const text = document.lineAt(i).text;
        const m = MODULE_DOC_COMMENT_RE.exec(text);
        if (!m) break;
        const content = m[2].startsWith(" ") ? m[2].slice(1) : m[2];
        docLines.push(content);
        i++;
      }

      blocks.push({
        startLine,
        endLine: i - 1,
        lines: docLines,
        signature: undefined,
        isModuleDoc: true,
      });
    } else if (docMatch) {
      // /// item-level doc comment block
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
          let sig = text;
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
        isModuleDoc: false,
      });
    } else {
      i++;
    }
  }

  return blocks;
}

/**
 * Find the doc block that contains or is closest above the given line.
 * Falls back to the nearest block above the cursor, or the first block.
 */
export function findDocBlockAtLine(
  blocks: DocBlock[],
  line: number,
): DocBlock | undefined {
  if (blocks.length === 0) return undefined;

  // Check if cursor is inside a doc block
  for (const block of blocks) {
    if (line >= block.startLine && line <= block.endLine) {
      return block;
    }
  }

  // Check if cursor is on the signature line (right after a doc block)
  for (const block of blocks) {
    if (line > block.endLine && line <= block.endLine + 5) {
      return block;
    }
  }

  // Fall back to nearest block above cursor
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].startLine <= line) {
      return blocks[i];
    }
  }

  // Cursor is above all blocks — return first
  return blocks[0];
}
