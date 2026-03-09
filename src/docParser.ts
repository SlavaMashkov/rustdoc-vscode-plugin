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

/** Consume consecutive lines matching `pattern` starting at line `start`, returning doc content lines and end index. */
function consumeDocBlock(
  document: vscode.TextDocument,
  start: number,
  pattern: RegExp,
): { docLines: string[]; nextLine: number } {
  const docLines: string[] = [];
  let i = start;
  while (i < document.lineCount) {
    const m = pattern.exec(document.lineAt(i).text);
    if (!m) break;
    const content = m[2].startsWith(" ") ? m[2].slice(1) : m[2];
    docLines.push(content);
    i++;
  }
  return { docLines, nextLine: i };
}

export function parseDocBlocks(document: vscode.TextDocument): DocBlock[] {
  const blocks: DocBlock[] = [];
  const lineCount = document.lineCount;
  let i = 0;

  while (i < lineCount) {
    const lineText = document.lineAt(i).text;
    const isModuleDoc = MODULE_DOC_COMMENT_RE.test(lineText);
    const isItemDoc = !isModuleDoc && DOC_COMMENT_RE.test(lineText);

    if (isModuleDoc || isItemDoc) {
      const pattern = isModuleDoc ? MODULE_DOC_COMMENT_RE : DOC_COMMENT_RE;
      const { docLines, nextLine } = consumeDocBlock(document, i, pattern);
      blocks.push({
        startLine: i,
        endLine: nextLine - 1,
        lines: docLines,
        isModuleDoc,
      });
      i = nextLine;
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
  for (let idx = blocks.length - 1; idx >= 0; idx--) {
    const block = blocks[idx];
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

/** Collect text for lines [from, to] from the document. */
function getLineTexts(
  document: vscode.TextDocument,
  from: number,
  to: number,
): string[] {
  const lines: string[] = [];
  for (let i = from; i <= to; i++) {
    lines.push(document.lineAt(i).text);
  }
  return lines;
}

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

  function addCodeSegment(startLine: number, endLine: number): void {
    if (startLine > endLine) return;
    segments.push({
      kind: "code",
      startLine,
      endLine,
      lines: getLineTexts(document, startLine, endLine),
    });
  }

  for (const block of blocks) {
    addCodeSegment(currentLine, block.startLine - 1);
    segments.push({
      kind: "doc",
      startLine: block.startLine,
      endLine: block.endLine,
      block,
    });
    currentLine = block.endLine + 1;
  }

  addCodeSegment(currentLine, lineCount - 1);

  return segments;
}
