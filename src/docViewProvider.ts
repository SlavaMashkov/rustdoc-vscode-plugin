import * as path from "path";
import * as vscode from "vscode";
import { parseFileSegments, FileSegment } from "./docParser";
import { renderFullFileToHtml } from "./markdownRenderer";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class DocPreviewPanel {
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];
  private lastRustEditor: vscode.TextEditor | undefined;

  private cachedSegments: FileSegment[] = [];
  private lastDocUri = "";
  private lastDocVersion = -1;

  /** Suppress flag to break scroll sync loops */
  private ignoreNextWebviewScroll = false;
  private ignoreTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  open(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
      this.update();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "rustdocPreview",
      "Rust Doc Side Viewer",
      {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
      },
      {
        enableScripts: true,
        localResourceRoots: [],
      },
    );

    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg.type === "scrollEditorToLine") {
          this.handleWebviewScroll(msg.line);
        } else if (msg.type === "navigateToSymbol") {
          this.navigateToSymbol(msg.path);
        }
      },
      null,
      this.disposables,
    );

    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
        this.resetCache();
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
      },
      null,
      this.disposables,
    );

    this.update();
  }

  trackEditor(editor: vscode.TextEditor | undefined): void {
    if (editor && editor.document.languageId === "rust") {
      this.lastRustEditor = editor;
    }
  }

  update(): void {
    if (!this.panel) return;

    const editor = this.getRustEditor();
    if (!editor) {
      this.showEmpty();
      return;
    }

    try {
      const docUri = editor.document.uri.toString();
      const docVersion = editor.document.version;

      if (docUri !== this.lastDocUri || docVersion !== this.lastDocVersion) {
        this.cachedSegments = parseFileSegments(editor.document);

        const fileName = path.basename(editor.document.fileName);
        this.panel.title = `Preview: ${fileName}`;

        const bodyHtml = renderFullFileToHtml(this.cachedSegments);
        this.panel.webview.html = this.wrapHtml(bodyHtml);
        this.lastDocUri = docUri;
        this.lastDocVersion = docVersion;

        // Restore scroll position after re-render
        const topLine = editor.visibleRanges[0]?.start.line ?? 0;
        setTimeout(() => {
          this.sendScrollToLine(topLine);
        }, 50);
      }
    } catch (err) {
      console.error("[rustdoc-viewer] Failed to render preview:", err);
    }
  }

  /** Sync preview scroll to editor's visible range */
  syncScroll(editor: vscode.TextEditor): void {
    if (!this.panel) return;
    if (editor.document.languageId !== "rust") return;

    const topLine = editor.visibleRanges[0]?.start.line ?? 0;
    this.sendScrollToLine(topLine);
  }

  isVisible(): boolean {
    return this.panel !== undefined;
  }

  dispose(): void {
    if (this.ignoreTimer) clearTimeout(this.ignoreTimer);
    this.panel?.dispose();
  }

  private getRustEditor(): vscode.TextEditor | undefined {
    const active = vscode.window.activeTextEditor;
    if (active && active.document.languageId === "rust") return active;
    if (this.lastRustEditor && !this.lastRustEditor.document.isClosed) {
      return this.lastRustEditor;
    }
    this.lastRustEditor = undefined;
    return undefined;
  }

  private sendScrollToLine(line: number): void {
    if (!this.panel) return;
    this.ignoreNextWebviewScroll = true;
    if (this.ignoreTimer) clearTimeout(this.ignoreTimer);
    this.ignoreTimer = setTimeout(() => {
      this.ignoreNextWebviewScroll = false;
    }, 200);
    void this.panel.webview.postMessage({ type: "scrollToLine", line }).then(undefined, () => {});
  }

  private handleWebviewScroll(line: number): void {
    if (this.ignoreNextWebviewScroll) return;

    const editor = this.getRustEditor();
    if (!editor) return;

    const range = new vscode.Range(line, 0, line, 0);
    editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
  }

  private async navigateToSymbol(path: string): Promise<void> {
    try {
      let parts = path.split("::");

      // Strip crate:: prefix (refers to current crate)
      if (parts[0] === "crate") parts = parts.slice(1);

      const searchName = parts[parts.length - 1];
      const container = parts.length > 1 ? parts[parts.length - 2] : undefined;
      const editor = this.getRustEditor();

      // 1. Search in current document (strict: with container)
      if (editor) {
        const found = await this.findInDocument(editor.document, searchName, container);
        if (found) {
          await vscode.window.showTextDocument(editor.document, {
            selection: found,
            viewColumn: vscode.ViewColumn.One,
          });
          return;
        }
      }

      // 2. Use LSP go-to-definition: find the symbol name in code and Ctrl+click it
      if (editor) {
        const target = await this.resolveViaDefinitionProvider(editor.document, parts);
        if (target) {
          const doc = await vscode.workspace.openTextDocument(target.uri);
          const isSameFile = doc.uri.toString() === editor.document.uri.toString();
          await vscode.window.showTextDocument(doc, {
            selection: target.range,
            viewColumn: vscode.ViewColumn.One,
            preview: !isSameFile,
          });
          return;
        }
      }

      // 3. Loose fallback: search current document without container
      if (editor && container) {
        const loose = await this.findInDocument(editor.document, searchName, undefined);
        if (loose) {
          await vscode.window.showTextDocument(editor.document, {
            selection: loose,
            viewColumn: vscode.ViewColumn.One,
          });
          return;
        }
      }

      vscode.window.showInformationMessage(`Symbol not found: ${path}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[rustdoc-viewer] navigateToSymbol failed:", err);
      vscode.window.showWarningMessage(`Could not navigate to ${path}: ${message}`);
    }
  }

  /**
   * Find the symbol in code (not doc comments) and use LSP definition provider,
   * like Ctrl+click. For "Builder::format", finds "Builder" in code, goes to
   * its definition, then finds "format" there.
   */
  private async resolveViaDefinitionProvider(
    document: vscode.TextDocument,
    parts: string[],
  ): Promise<{ uri: vscode.Uri; range: vscode.Range } | undefined> {
    // For multi-part paths (Builder::format), resolve the container first
    if (parts.length > 1) {
      const containerName = parts[parts.length - 2];
      const memberName = parts[parts.length - 1];

      const containerPos = this.findIdentifierInCode(document, containerName);
      if (containerPos) {
        const loc = await this.getDefinitionLocation(document.uri, containerPos);
        if (loc) {
          const defDoc = await vscode.workspace.openTextDocument(loc.uri);
          const found = await this.findInDocument(defDoc, memberName, containerName);
          if (found) return { uri: loc.uri, range: found };
          const loose = await this.findInDocument(defDoc, memberName, undefined);
          if (loose) return { uri: loc.uri, range: loose };
        }
      }
    }

    // For single-part paths or if multi-part failed, find the name directly
    const searchName = parts[parts.length - 1];
    const pos = this.findIdentifierInCode(document, searchName);
    if (pos) {
      const loc = await this.getDefinitionLocation(document.uri, pos);
      if (loc) return loc;
    }

    return undefined;
  }

  /** Call LSP definition provider and normalize Location/LocationLink result */
  private async getDefinitionLocation(
    uri: vscode.Uri,
    position: vscode.Position,
  ): Promise<{ uri: vscode.Uri; range: vscode.Range } | undefined> {
    let results;
    try {
      results = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        "vscode.executeDefinitionProvider",
        uri,
        position,
      );
    } catch (err) {
      console.warn("[rustdoc-viewer] LSP definition provider failed:", err);
      return undefined;
    }
    if (!results || results.length === 0) return undefined;

    const def = results[0];
    // LocationLink has targetUri/targetSelectionRange, Location has uri/range
    if ("targetUri" in def) {
      return { uri: def.targetUri, range: def.targetSelectionRange ?? def.targetRange };
    }
    if ("uri" in def && def.uri) {
      return { uri: def.uri, range: def.range };
    }
    return undefined;
  }

  /** Find an identifier in code lines, preferring non-comment code */
  private findIdentifierInCode(
    document: vscode.TextDocument,
    name: string,
  ): vscode.Position | undefined {
    const escaped = escapeRegex(name);
    const patterns = [
      new RegExp(`\\b${escaped}\\b`),
      new RegExp(`\\b${escaped}!`),
    ];
    const skipComments = [true, false];

    for (const skipComment of skipComments) {
      for (const wordRe of patterns) {
        for (let i = 0; i < document.lineCount; i++) {
          const line = document.lineAt(i).text;
          if (skipComment) {
            const trimmed = line.trimStart();
            if (trimmed.startsWith("//")) continue;
          }
          const match = wordRe.exec(line);
          if (match) {
            return new vscode.Position(i, match.index);
          }
        }
      }
    }
    return undefined;
  }

  private async findInDocument(
    document: vscode.TextDocument,
    name: string,
    container: string | undefined,
  ): Promise<vscode.Range | undefined> {
    // Try document symbol provider (LSP)
    const docSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      document.uri,
    );
    if (docSymbols && docSymbols.length > 0) {
      const found = this.findSymbolRecursive(docSymbols, name, container);
      if (found) return found.selectionRange;
    }

    // Fallback: regex search in document text
    const pattern = new RegExp(
      `^\\s*(?:pub(?:\\(.*?\\))?\\s+)?(?:fn|struct|enum|trait|type|const|static|mod|macro|impl)\\s+${escapeRegex(name)}\\b`,
    );
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i).text;
      if (pattern.test(line)) {
        if (!container) return new vscode.Range(i, 0, i, 0);
        // Check that this is inside the right impl block
        const implPattern = new RegExp(`impl.*\\b${escapeRegex(container)}\\b`);
        for (let j = i - 1; j >= 0; j--) {
          if (implPattern.test(document.lineAt(j).text)) {
            return new vscode.Range(i, 0, i, 0);
          }
          if (/^(?:pub|fn|struct|enum|trait|mod|use)\b/.test(document.lineAt(j).text.trimStart())) {
            break;
          }
        }
      }
    }

    return undefined;
  }

  private findSymbolRecursive(
    symbols: vscode.DocumentSymbol[],
    name: string,
    container: string | undefined,
  ): vscode.DocumentSymbol | undefined {
    for (const sym of symbols) {
      // Direct match (no container required)
      if (sym.name === name && !container) return sym;

      if (sym.children.length > 0) {
        // Check direct children with container match on parent
        for (const child of sym.children) {
          if (child.name === name) {
            if (!container || sym.name.includes(container)) return child;
          }
        }
        // Recurse deeper
        const deep = this.findSymbolRecursive(sym.children, name, container);
        if (deep) return deep;
      }
    }
    return undefined;
  }

  private showEmpty(): void {
    if (!this.panel) return;
    if (this.lastDocUri === "" && this.cachedSegments.length === 0) return;
    this.resetCache();
    this.panel.webview.html = this.wrapHtml(
      '<p class="empty">No Rust file with doc comments is open.</p>',
    );
  }

  private resetCache(): void {
    this.cachedSegments = [];
    this.lastDocUri = "";
    this.lastDocVersion = -1;
  }

  private wrapHtml(body: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body {
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 0;
    line-height: 1.6;
    margin: 0;
  }

  /* Code segments */
  .code-segment {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    line-height: var(--vscode-editor-line-height, 1.5);
    margin: 0;
    padding: 2px 16px 2px 48px;
    background: var(--vscode-editor-background);
    border: none;
    white-space: pre;
    overflow-x: auto;
    counter-reset: line-number var(--line-start);
    color: var(--vscode-editor-foreground, var(--vscode-foreground));
  }

  .code-segment span[data-line] {
    display: block;
    position: relative;
  }

  .code-segment span[data-line]::before {
    content: attr(data-line-display);
    position: absolute;
    left: -36px;
    width: 28px;
    text-align: right;
    color: var(--vscode-editorLineNumber-foreground, rgba(127,127,127,0.5));
    font-size: 0.9em;
    user-select: none;
  }

  /* Doc segments */
  .doc-segment {
    padding: 10px 20px 10px 48px;
    border-left: 3px solid var(--vscode-textLink-foreground, #4080d0);
    margin: 2px 0;
    background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.05));
  }

  .module-header {
    font-size: 1.2em;
    font-weight: 600;
    margin-bottom: 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.2));
    color: var(--vscode-foreground);
  }

  h3 {
    font-size: 1.1em;
    margin: 16px 0 6px 0;
    padding-bottom: 3px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.2));
    color: var(--vscode-foreground);
  }

  h4, h5, h6 {
    font-size: 1em;
    margin: 12px 0 4px 0;
    color: var(--vscode-foreground);
  }

  p {
    margin: 6px 0;
  }

  code {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.92em;
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.15));
    padding: 1px 4px;
    border-radius: 3px;
  }

  pre {
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.15));
    padding: 8px 10px;
    border-radius: 4px;
    overflow-x: auto;
    margin: 6px 0;
  }

  /* Code blocks inside doc segments — not the top-level code segments */
  .doc-segment pre {
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.15));
  }

  .doc-segment pre code,
  pre code {
    background: none;
    padding: 0;
    font-size: var(--vscode-editor-font-size, 13px);
    line-height: 1.4;
  }

  ul {
    margin: 6px 0;
    padding-left: 20px;
  }

  li {
    margin: 3px 0;
  }

  a {
    color: var(--vscode-textLink-foreground, #4080d0);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  .intra-doc {
    color: var(--vscode-textLink-foreground, #4080d0);
    text-decoration: none;
    cursor: pointer;
  }

  .intra-doc:hover {
    text-decoration: underline;
  }

  .empty {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    padding: 16px 24px;
  }

  /* Syntax highlighting — dark theme (default) */
  .hljs-keyword,
  .hljs-built_in { color: #569cd6; }
  .hljs-type,
  .hljs-title.class_ { color: #4ec9b0; }
  .hljs-title.function_ { color: #dcdcaa; }
  .hljs-string,
  .hljs-char { color: #ce9178; }
  .hljs-number { color: #b5cea8; }
  .hljs-comment { color: #6a9955; font-style: italic; }
  .hljs-literal { color: #569cd6; }
  .hljs-meta { color: #c586c0; }
  .hljs-attr,
  .hljs-variable { color: #9cdcfe; }
  .hljs-operator,
  .hljs-punctuation { color: var(--vscode-editor-foreground, #d4d4d4); }

  /* Syntax highlighting — light theme overrides */
  .vscode-light .hljs-keyword,
  .vscode-light .hljs-built_in { color: #0000ff; }
  .vscode-light .hljs-type,
  .vscode-light .hljs-title.class_ { color: #267f99; }
  .vscode-light .hljs-title.function_ { color: #795e26; }
  .vscode-light .hljs-string,
  .vscode-light .hljs-char { color: #a31515; }
  .vscode-light .hljs-number { color: #098658; }
  .vscode-light .hljs-comment { color: #008000; font-style: italic; }
  .vscode-light .hljs-literal { color: #0000ff; }
  .vscode-light .hljs-meta { color: #af00db; }
  .vscode-light .hljs-attr,
  .vscode-light .hljs-variable { color: #001080; }
</style>
</head>
<body>
${body}
<script>
(function() {
  var vscodeApi = acquireVsCodeApi();
  var ignoreScroll = false;
  var ignoreTimer = null;

  // Calculate exact pixel scroll position for a given source line
  function getScrollPositionForLine(line) {
    var segments = document.querySelectorAll('[data-line-start]');
    var lastSegEnd = null;

    for (var i = 0; i < segments.length; i++) {
      var start = parseInt(segments[i].getAttribute('data-line-start'), 10);
      var end = parseInt(segments[i].getAttribute('data-line-end'), 10);

      if (line >= start && line <= end) {
        // For code segments, find exact line span
        var exact = segments[i].querySelector('[data-line="' + line + '"]');
        if (exact) {
          return exact.getBoundingClientRect().top + window.scrollY;
        }
        // For doc segments, interpolate proportionally
        var rect = segments[i].getBoundingClientRect();
        var segTop = rect.top + window.scrollY;
        var progress = (end > start) ? (line - start) / (end - start) : 0;
        return segTop + progress * rect.height;
      }
      if (start <= line) lastSegEnd = segments[i];
    }

    // Line is past all segments or between segments — use last known
    if (lastSegEnd) {
      var rect = lastSegEnd.getBoundingClientRect();
      return rect.top + window.scrollY + rect.height;
    }
    return 0;
  }

  // Get the source line at the top of the viewport
  function getLineAtViewportTop() {
    var segments = document.querySelectorAll('[data-line-start]');
    var scrollTop = window.scrollY;

    for (var i = 0; i < segments.length; i++) {
      var rect = segments[i].getBoundingClientRect();
      var segTop = rect.top + scrollTop;
      var segBottom = segTop + rect.height;

      if (segBottom > scrollTop) {
        var start = parseInt(segments[i].getAttribute('data-line-start'), 10);
        var end = parseInt(segments[i].getAttribute('data-line-end'), 10);

        // Try exact line spans for code segments
        var lineSpans = segments[i].querySelectorAll('[data-line]');
        if (lineSpans.length > 0) {
          for (var j = 0; j < lineSpans.length; j++) {
            var spanRect = lineSpans[j].getBoundingClientRect();
            if (spanRect.top + scrollTop + spanRect.height > scrollTop) {
              return parseInt(lineSpans[j].getAttribute('data-line'), 10);
            }
          }
        }

        // Interpolate for doc segments
        var progress = Math.max(0, (scrollTop - segTop) / rect.height);
        return Math.round(start + progress * (end - start));
      }
    }
    return 0;
  }

  // Handle scroll-to-line from extension
  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.type === 'scrollToLine') {
      ignoreScroll = true;
      if (ignoreTimer) clearTimeout(ignoreTimer);
      ignoreTimer = setTimeout(function() { ignoreScroll = false; }, 200);

      var pos = getScrollPositionForLine(msg.line);
      window.scrollTo(0, pos);
    }
  });

  // Send scroll position back to extension (debounced)
  var scrollTimer = null;
  window.addEventListener('scroll', function() {
    if (ignoreScroll) return;
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function() {
      var line = getLineAtViewportTop();
      vscodeApi.postMessage({ type: 'scrollEditorToLine', line: line });
    }, 30);
  });
  // Handle clicks on intra-doc links
  document.addEventListener('click', function(event) {
    var target = event.target;
    while (target && target !== document.body) {
      if (target.classList && target.classList.contains('intra-doc')) {
        event.preventDefault();
        var path = target.getAttribute('data-path');
        if (path) {
          vscodeApi.postMessage({ type: 'navigateToSymbol', path: path });
        }
        return;
      }
      target = target.parentElement;
    }
  });
})();
</script>
</body>
</html>`;
  }
}
