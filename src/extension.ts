import * as vscode from "vscode";
import { DocPreviewPanel } from "./docViewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const preview = new DocPreviewPanel(context.extensionUri);

  context.subscriptions.push(
    vscode.commands.registerCommand("rustdocViewer.openPreview", () => {
      preview.open();
    }),
  );

  preview.trackEditor(vscode.window.activeTextEditor);

  // Scroll sync: editor viewport → preview
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      preview.trackEditor(e.textEditor);
      if (preview.isVisible()) {
        preview.syncScroll(e.textEditor);
      }
    }),
  );

  // Re-render when switching files
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      preview.trackEditor(editor);
      if (preview.isVisible()) {
        preview.update();
      }
    }),
  );

  // Re-render on document content change (debounced)
  let docChangeTimer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === "rust" && preview.isVisible()) {
        if (docChangeTimer) clearTimeout(docChangeTimer);
        docChangeTimer = setTimeout(() => {
          try { preview.update(); } catch (err) {
            console.error("[rustdoc-viewer] Error during debounced update:", err);
          }
        }, 300);
      }
    }),
  );

  context.subscriptions.push({
    dispose: () => {
      if (docChangeTimer) clearTimeout(docChangeTimer);
      preview.dispose();
    },
  });
}

export function deactivate(): void {}
