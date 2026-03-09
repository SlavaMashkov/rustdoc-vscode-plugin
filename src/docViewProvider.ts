import * as path from "path";
import * as vscode from "vscode";
import { parseFileSegments, FileSegment } from "./docParser";
import { renderFullFileToHtml } from "./markdownRenderer";
import { navigateToSymbol } from "./symbolNavigation";
import { wrapHtml } from "./webviewHtml";

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
          navigateToSymbol(msg.path, () => this.getRustEditor());
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
        this.panel.webview.html = wrapHtml(bodyHtml);
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

  private showEmpty(): void {
    if (!this.panel) return;
    if (this.lastDocUri === "" && this.cachedSegments.length === 0) return;
    this.resetCache();
    this.panel.webview.html = wrapHtml(
      '<p class="empty">No Rust file with doc comments is open.</p>',
    );
  }

  private resetCache(): void {
    this.cachedSegments = [];
    this.lastDocUri = "";
    this.lastDocVersion = -1;
  }
}
