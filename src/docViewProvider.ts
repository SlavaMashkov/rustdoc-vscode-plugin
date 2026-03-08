import * as vscode from "vscode";
import { parseDocBlocks, findDocBlockAtLine } from "./docParser";
import { renderDocToHtml } from "./markdownRenderer";

export class DocViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "rustdocViewer.docView";

  private view?: vscode.WebviewView;
  private lastRenderedKey = "";

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: false,
    };

    this.updateForCurrentEditor();
  }

  updateForCurrentEditor(): void {
    const editor = vscode.window.activeTextEditor;
    if (!this.view || !editor || editor.document.languageId !== "rust") {
      this.showEmpty();
      return;
    }

    const cursorLine = editor.selection.active.line;
    const blocks = parseDocBlocks(editor.document);
    const block = findDocBlockAtLine(blocks, cursorLine);

    if (!block) {
      this.showEmpty();
      return;
    }

    // Avoid re-rendering the same block
    const key = `${editor.document.uri.toString()}:${block.startLine}`;
    if (key === this.lastRenderedKey) {
      return;
    }
    this.lastRenderedKey = key;

    const bodyHtml = renderDocToHtml(block);
    this.view.webview.html = this.wrapHtml(bodyHtml);
  }

  private showEmpty(): void {
    if (!this.view) return;
    if (this.lastRenderedKey === "") return;
    this.lastRenderedKey = "";
    this.view.webview.html = this.wrapHtml(
      '<p class="empty">Place cursor on a <code>///</code> doc comment or documented item to see rendered documentation.</p>',
    );
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
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    padding: 12px 16px;
    line-height: 1.5;
    margin: 0;
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
</body>
</html>`;
  }
}
