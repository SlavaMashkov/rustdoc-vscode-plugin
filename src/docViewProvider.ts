import * as vscode from "vscode";
import { parseDocBlocks, findDocBlockAtLine, DocBlock } from "./docParser";
import { renderAllBlocksToHtml } from "./markdownRenderer";

export class DocPreviewPanel {
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];
  private lastRustEditor: vscode.TextEditor | undefined;

  /** Cached state to avoid full re-renders on every cursor move */
  private cachedBlocks: DocBlock[] = [];
  private lastDocUri = "";
  private lastDocVersion = -1;
  private lastScrollTarget = "";

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

    const active = vscode.window.activeTextEditor;
    const editor =
      active && active.document.languageId === "rust"
        ? active
        : this.lastRustEditor;

    if (!editor || editor.document.isClosed) {
      this.lastRustEditor = undefined;
      this.showEmpty();
      return;
    }

    const docUri = editor.document.uri.toString();
    const docVersion = editor.document.version;

    // Full re-render when file or content changes
    if (docUri !== this.lastDocUri || docVersion !== this.lastDocVersion) {
      this.cachedBlocks = parseDocBlocks(editor.document);

      if (this.cachedBlocks.length === 0) {
        this.showEmpty();
        return;
      }

      const fileName =
        editor.document.fileName.split("/").pop() ?? "Rust Doc";
      this.panel.title = `Preview: ${fileName}`;

      const bodyHtml = renderAllBlocksToHtml(this.cachedBlocks);
      this.panel.webview.html = this.wrapHtml(bodyHtml);
      this.lastDocUri = docUri;
      this.lastDocVersion = docVersion;
      this.lastScrollTarget = "";
    }

    // Scroll to nearest block
    const cursorLine = editor.selection.active.line;
    const block = findDocBlockAtLine(this.cachedBlocks, cursorLine);
    if (block) {
      const blockId = `doc-block-${block.startLine}`;
      if (blockId !== this.lastScrollTarget) {
        this.lastScrollTarget = blockId;
        this.panel.webview.postMessage({ type: "scrollTo", blockId });
      }
    }
  }

  isVisible(): boolean {
    return this.panel !== undefined;
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private showEmpty(): void {
    if (!this.panel) return;
    if (this.lastDocUri === "" && this.cachedBlocks.length === 0) return;
    this.resetCache();
    this.panel.webview.html = this.wrapHtml(
      '<p class="empty">No doc comments found in this file.</p>',
    );
  }

  private resetCache(): void {
    this.cachedBlocks = [];
    this.lastDocUri = "";
    this.lastDocVersion = -1;
    this.lastScrollTarget = "";
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
    padding: 16px 24px;
    line-height: 1.6;
    margin: 0;
  }

  .doc-section {
    padding: 8px 12px;
    border-left: 3px solid transparent;
    border-radius: 2px;
    transition: border-color 0.3s, background-color 0.3s;
  }

  .doc-section.active {
    border-left-color: var(--vscode-textLink-foreground, #4080d0);
    background: var(--vscode-editor-selectionBackground, rgba(100,100,200,0.08));
  }

  .section-divider {
    border: none;
    border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.2));
    margin: 16px 0;
  }

  .module-header {
    font-size: 1.2em;
    font-weight: 600;
    margin-bottom: 16px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.2));
    color: var(--vscode-foreground);
  }

  .signature {
    background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.1));
    border-left: 3px solid var(--vscode-textLink-foreground, #4080d0);
    padding: 8px 12px;
    margin-bottom: 16px;
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
    margin: 20px 0 8px 0;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.2));
    color: var(--vscode-foreground);
  }

  h4, h5, h6 {
    font-size: 1em;
    margin: 16px 0 6px 0;
    color: var(--vscode-foreground);
  }

  p {
    margin: 8px 0;
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
    padding: 10px 12px;
    border-radius: 4px;
    overflow-x: auto;
    margin: 8px 0;
  }

  pre code {
    background: none;
    padding: 0;
    font-size: var(--vscode-editor-font-size, 13px);
    line-height: 1.4;
  }

  ul {
    margin: 8px 0;
    padding-left: 20px;
  }

  li {
    margin: 4px 0;
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
  }
</style>
</head>
<body>
${body}
<script>
  (function() {
    window.addEventListener('message', function(event) {
      var msg = event.data;
      if (msg.type === 'scrollTo') {
        document.querySelectorAll('.doc-section.active').forEach(function(el) {
          el.classList.remove('active');
        });
        var target = document.getElementById(msg.blockId);
        if (target) {
          target.classList.add('active');
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  })();
</script>
</body>
</html>`;
  }
}
