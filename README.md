# Rust Doc Viewer

Preview Rust `///` and `//!` doc comments as formatted documentation in a side panel — like the built-in Markdown preview, but for Rust doc comments.

## Features

- **Full-file preview** — code stays as-is, doc comments are rendered as formatted HTML
- **Syntax highlighting** — Rust code in both source and doc examples is highlighted
- **Scroll sync** — bidirectional scroll sync keeps the editor and preview aligned
- **Intra-doc links** — click `[`Builder::format`]` to jump to the symbol definition using rust-analyzer
- **Rustdoc URL support** — relative links like `struct.Builder.html#method.init` are parsed and navigable
- **Reference links** — `[label]: url` definitions are resolved and rendered as clickable links
- **Hidden lines** — lines starting with `# ` in doc code examples are hidden (rustdoc convention)
- **Theme integration** — colors follow your VSCode theme (dark, light, high contrast)

## Usage

1. Open a Rust file
2. Click the book icon in the editor title bar, or run **Rust Doc: Open Preview to the Side** from the command palette (`Ctrl+Shift+P`)
3. The preview opens in a side panel and updates as you edit

## Requirements

- VSCode 1.85.0 or later
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) (recommended, for intra-doc link navigation)

## Installation

### From VS Code Marketplace

Search for **Rust Doc Viewer** in the Extensions view (`Ctrl+Shift+X`).

### From VSIX

```bash
# Build the extension
npm install
npm run compile
npx @vscode/vsce package --allow-missing-repository -o ./vsix_out/

# Install
code --install-extension ./vsix_out/rustdoc-viewer-*.vsix
```

## How It Works

The extension parses `///` and `//!` doc comment blocks from the active Rust file and renders them as HTML in a WebviewPanel. Code between doc blocks is displayed with syntax highlighting and line numbers. The result is a continuous document where documentation and code are interleaved — similar to how `cargo doc` renders documentation, but live in your editor.

Clicking on intra-doc links (like `[`Write`]: std::io::Write`) uses the same mechanism as Ctrl+click — `vscode.executeDefinitionProvider` via rust-analyzer — to navigate to the symbol's source.

## Contributing

Contributions are welcome! Please open an issue or pull request on [GitHub](https://github.com/SlavaMashkov/rustdoc-vscode-plugin).

```bash
# Development
npm install
npm run watch       # rebuild on changes
# Press F5 in VSCode to launch Extension Development Host

# Type checking
npm run typecheck
```

## License

[MIT](LICENSE)
