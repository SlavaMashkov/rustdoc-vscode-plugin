# Changelog

## [0.4.0] - 2026-03-09

### Added
- Prepare for publication: README, LICENSE (MIT), CHANGELOG
- package.json marketplace fields (publisher, keywords, repository, etc.)

### Changed
- Editor title bar icon: `$(open-preview)` → `$(book)`

## [0.3.4] - 2026-03-09

### Fixed
- Error handling: try-catch on render, LSP calls, postMessage
- Cross-platform path handling (`path.basename` instead of `split("/")`)
- Inaccurate code comments (comment rot)
- CLAUDE.md synced with actual codebase state

## [0.3.2] - 2026-03-09

### Added
- Intra-doc link navigation — click [`Builder::format`] to jump to symbol definition
- Relative rustdoc URL navigation — `struct.Builder.html#method.init` links are clickable
- LSP-based symbol resolution via `vscode.executeDefinitionProvider` (same as Ctrl+click)
- Support for `std::io::Write` style reference links via rust-analyzer

### Fixed
- Symbol navigation precision — no longer jumps to wrong symbol when names collide
- LocationLink handling — correctly uses `targetSelectionRange` instead of `targetRange`

## [0.3.0] - 2026-03-09

### Added
- Syntax highlighting in code blocks using highlight.js (Rust language only)
- Dark and light theme support for syntax colors via `.vscode-light`/`.vscode-dark`

### Changed
- Switched from `tsc` to `esbuild` bundler for compilation (bundles highlight.js)

### Removed
- Signature headers (`pub fn new() -> Builder`) from doc block rendering

## [0.2.0] - 2026-03-09

### Added
- Full-file rendered view with interleaved code and doc segments
- Bidirectional scroll sync between editor and preview
- Line numbers in code segments
- Pixel-accurate scroll sync positioning

### Changed
- Render all doc blocks as a single scrollable document (closer to `cargo doc`)

## [0.0.7] - 2026-03-09

### Added
- `.vscodeignore` to exclude unnecessary files from packaged `.vsix`

### Changed
- Rewrite inline markdown parser with single-pass regex tokenization
- Render backtick code spans inside link text as inline `<code>`

## [0.0.5] - 2026-03-08

### Added
- Reference link resolution — `[label]: url` definitions rendered as clickable links
- `[name][label]` and shortcut `[name]` markdown link forms

## [0.0.4] - 2026-03-08

### Added
- `//!` module-level doc comment support
- Expanded test file with all rustdoc constructs

## [0.0.3] - 2026-03-08

### Added
- Hidden line stripping in doc code examples (lines starting with `# `)

## [0.0.2] - 2026-03-08

### Changed
- Preview panel opens to the side (like Markdown preview)
- Preserve preview content when webview panel receives focus

## [0.0.1] - 2026-03-08

### Added
- Initial release
- Basic `///` doc comment rendering in a side panel
- Markdown formatting: headings, bold, italic, code, lists, links
