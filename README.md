# iGenius Memory — Desktop Client

A standalone desktop companion for [iGenius Memory](https://igenius-memory.online) — persistent, encrypted AI memory that survives across sessions and context resets.

Built with [Tauri v2](https://v2.tauri.app) for lightweight, native performance.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Platform](https://img.shields.io/badge/platform-Windows-0078D4)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Memory Dashboard** — View and manage all memory layers (pinned, long-term, short-term, persistent) in one place
- **Project Scoping** — Switch between project-scoped and global memories
- **Memory Search** — Full-text search across all layers
- **Pin Management** — Review suggested pins and promote important memories
- **Settings** — Configure API key, server URL, LLM provider, and model
- **System Tray** — Runs quietly in the background, always accessible
- **Lightweight** — ~8MB installer, minimal resource usage (Tauri, not Electron)

## Install

### Windows

Download the latest `.exe` installer from [Releases](https://github.com/vehoelite/igenius-desktop/releases).

Run the installer — it will create a Start Menu shortcut under **iGenius Memory**.

### Build from Source

Prerequisites:
- [Node.js](https://nodejs.org) 18+
- [Rust](https://rustup.rs) 1.77+
- [Tauri CLI prerequisites](https://v2.tauri.app/start/prerequisites/)

```bash
git clone https://github.com/vehoelite/igenius-desktop.git
cd igenius-desktop
npm install
npm run build
```

The installer will be in `src-tauri/target/release/bundle/nsis/`.

## Getting Started

1. **Get an API key** — Visit [igenius-memory.store](https://igenius-memory.store) to create a free account
2. **Launch the app** — Enter your API key and connect
3. **Set your project** — Scope memories to your current workspace (optional)

The desktop client connects to the iGenius Memory API at `https://igenius-memory.online/v1` by default.

## LLM Provider Support

Configure your preferred LLM provider in Settings:

| Provider | Notes |
|----------|-------|
| **LM Studio** | Local/remote. Set base URL and model name. |
| **OpenAI** | GPT-4o and family. Requires API key. |
| **Anthropic** | Claude Sonnet / Opus / Haiku. Requires API key. |
| **Google** | Gemini models. Requires API key. |

## Architecture

```
┌──────────────────────┐
│  iGenius Desktop     │  Tauri v2 + vanilla HTML/CSS/JS
│  (system tray app)   │
└──────────┬───────────┘
           │ HTTPS
           ▼
┌──────────────────────┐
│  iGenius Memory API  │  igenius-memory.online/v1
│  (FastAPI backend)   │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  LLM Provider        │  LM Studio / OpenAI / Anthropic / Google
└──────────────────────┘
```

## Related Projects

- **[igenius-mcp](https://github.com/vehoelite/igenius-mcp)** — MCP server for Claude, Copilot, and other MCP-compatible agents (`pip install igenius-mcp`)
- **[igenius-vscode](https://github.com/vehoelite/igenius-vscode)** — VS Code extension with sidebar UI and auto-ingest

## Coming Soon

**iGenius Context Engine** — A transparent proxy that provides unlimited effective context for local LLMs through intelligent recursive summarization. Small models (1B–4B) will maintain coherent conversations far beyond their native context window.

## License

MIT
