import * as vscode from "vscode";
import { parseFileSegments, FileSegment } from "./docParser";
import { renderFullFileToHtml } from "./markdownRenderer";

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
      "Rust Doc Preview",
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

    const docUri = editor.document.uri.toString();
    const docVersion = editor.document.version;

    if (docUri !== this.lastDocUri || docVersion !== this.lastDocVersion) {
      this.cachedSegments = parseFileSegments(editor.document);

      const fileName =
        editor.document.fileName.split("/").pop() ?? "Rust Doc";
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
    this.panel.webview.postMessage({ type: "scrollToLine", line });
  }

  private handleWebviewScroll(line: number): void {
    if (this.ignoreNextWebviewScroll) return;

    const editor = this.getRustEditor();
    if (!editor) return;

    const range = new vscode.Range(line, 0, line, 0);
    editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
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

  .signature {
    background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.1));
    border-left: 3px solid var(--vscode-textLink-foreground, #4080d0);
    padding: 6px 10px;
    margin-bottom: 12px;
    border-radius: 2px;
  }

  .signature code {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    background: none;
    padding: 0;
    color: var(--vscode-symbolIcon-functionForeground, var(--vscode-foreground));
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

  .empty {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    padding: 16px 24px;
  }
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
})();
</script>
</body>
</html>`;
  }
}
