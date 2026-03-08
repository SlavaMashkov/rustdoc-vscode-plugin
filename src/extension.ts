import * as vscode from "vscode";
import { DocPreviewPanel } from "./docViewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const preview = new DocPreviewPanel(context.extensionUri);

  // Button in editor title bar (top-right, like markdown preview)
  context.subscriptions.push(
    vscode.commands.registerCommand("rustdocViewer.openPreview", () => {
      preview.open();
    }),
  );

  // Track the last Rust editor so preview survives focus changes
  preview.trackEditor(vscode.window.activeTextEditor);

  // Update when cursor moves
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => {
      preview.trackEditor(e.textEditor);
      if (preview.isVisible()) {
        preview.update();
      }
    }),
  );

  // Update when switching files
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      preview.trackEditor(editor);
      if (preview.isVisible()) {
        preview.update();
      }
    }),
  );

  context.subscriptions.push({
    dispose: () => preview.dispose(),
  });
}

export function deactivate(): void {}
