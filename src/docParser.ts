import * as vscode from "vscode";

export interface DocBlock {
  startLine: number;
  endLine: number;
  /** Raw doc content lines (without leading `/// ` or `//! `) */
  lines: string[];
  /** Whether this is a module-level `//!` doc comment */
  isModuleDoc: boolean;
}

const DOC_COMMENT_RE = /^(\s*)\/\/\/(.*)$/;
const MODULE_DOC_COMMENT_RE = /^(\s*)\/\/!(.*)$/;
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

      blocks.push({
        startLine,
        endLine: i - 1,
        lines: docLines,
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

export type FileSegment =
  | { kind: "code"; startLine: number; endLine: number; lines: string[] }
  | { kind: "doc"; startLine: number; endLine: number; block: DocBlock };

/**
 * Parse the entire file into an ordered list of code and doc segments.
 * Code segments fill the gaps between doc blocks.
 */
export function parseFileSegments(
  document: vscode.TextDocument,
): FileSegment[] {
  const blocks = parseDocBlocks(document);
  const segments: FileSegment[] = [];
  const lineCount = document.lineCount;
  let currentLine = 0;

  for (const block of blocks) {
    // Code gap before this doc block
    if (currentLine < block.startLine) {
      const codeLines: string[] = [];
      for (let i = currentLine; i < block.startLine; i++) {
        codeLines.push(document.lineAt(i).text);
      }
      segments.push({
        kind: "code",
        startLine: currentLine,
        endLine: block.startLine - 1,
        lines: codeLines,
      });
    }

    // Doc segment
    segments.push({
      kind: "doc",
      startLine: block.startLine,
      endLine: block.endLine,
      block,
    });

    currentLine = block.endLine + 1;
  }

  // Trailing code after last doc block
  if (currentLine < lineCount) {
    const codeLines: string[] = [];
    for (let i = currentLine; i < lineCount; i++) {
      codeLines.push(document.lineAt(i).text);
    }
    segments.push({
      kind: "code",
      startLine: currentLine,
      endLine: lineCount - 1,
      lines: codeLines,
    });
  }

  return segments;
}
