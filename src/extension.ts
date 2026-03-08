import * as vscode from "vscode";
import { DocViewProvider } from "./docViewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new DocViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DocViewProvider.viewType,
      provider,
    ),
  );

  // Update panel when cursor moves
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(() => {
      provider.updateForCurrentEditor();
    }),
  );

  // Update panel when switching files
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      provider.updateForCurrentEditor();
    }),
  );

  // Show panel command
  context.subscriptions.push(
    vscode.commands.registerCommand("rustdocViewer.showDocPanel", () => {
      vscode.commands.executeCommand("rustdocViewer.docView.focus");
    }),
  );
}

export function deactivate(): void {}
