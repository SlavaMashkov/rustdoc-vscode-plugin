import * as vscode from "vscode";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Navigate to a symbol path (e.g. "Builder::format", "std::io::Write") */
export async function navigateToSymbol(
  path: string,
  getEditor: () => vscode.TextEditor | undefined,
): Promise<void> {
  try {
    let parts = path.split("::");

    // Strip crate:: prefix (refers to current crate)
    if (parts[0] === "crate") parts = parts.slice(1);

    const searchName = parts[parts.length - 1];
    const container = parts.length > 1 ? parts[parts.length - 2] : undefined;
    const editor = getEditor();

    // 1. Search in current document (strict: with container)
    if (editor) {
      const found = await findInDocument(editor.document, searchName, container);
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
      const target = await resolveViaDefinitionProvider(editor.document, parts);
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
      const loose = await findInDocument(editor.document, searchName, undefined);
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
async function resolveViaDefinitionProvider(
  document: vscode.TextDocument,
  parts: string[],
): Promise<{ uri: vscode.Uri; range: vscode.Range } | undefined> {
  // For multi-part paths (Builder::format), resolve the container first
  if (parts.length > 1) {
    const containerName = parts[parts.length - 2];
    const memberName = parts[parts.length - 1];

    const containerPos = findIdentifierInCode(document, containerName);
    if (containerPos) {
      const loc = await getDefinitionLocation(document.uri, containerPos);
      if (loc) {
        const defDoc = await vscode.workspace.openTextDocument(loc.uri);
        const found = await findInDocument(defDoc, memberName, containerName);
        if (found) return { uri: loc.uri, range: found };
        const loose = await findInDocument(defDoc, memberName, undefined);
        if (loose) return { uri: loc.uri, range: loose };
      }
    }
  }

  // For single-part paths or if multi-part failed, find the name directly
  const searchName = parts[parts.length - 1];
  const pos = findIdentifierInCode(document, searchName);
  if (pos) {
    const loc = await getDefinitionLocation(document.uri, pos);
    if (loc) return loc;
  }

  return undefined;
}

/** Call LSP definition provider and normalize Location/LocationLink result */
async function getDefinitionLocation(
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
function findIdentifierInCode(
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

async function findInDocument(
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
    const found = findSymbolRecursive(docSymbols, name, container);
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

function findSymbolRecursive(
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
      const deep = findSymbolRecursive(sym.children, name, container);
      if (deep) return deep;
    }
  }
  return undefined;
}
