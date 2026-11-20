Next Prompts automatically suggests clickable follow-up prompts right below every completed agent turn, without modifying AGENTS.md or replacing native Markdown rendering.

## How it works

When an agent finishes a turn, the plugin inspects the latest user request, assistant reply, tool outcomes, and workspace `git status`. It then appends a compact suggestion card directly below the reply. Click any suggestion to send it immediately, or click the edit icon to load it into the composer input before sending.

## Generation modes

- **Background Session (Auto-Archive · Default)**: Reuses your configured Paseo AI provider (Codex, Cursor, Claude, etc.) with zero extra API key. Spawns a temporary background session and automatically archives both the agent and workspace when done.
- **Direct LLM API (Base URL / Key)**: Calls an OpenAI-compatible HTTP endpoint (OpenAI, DeepSeek, OpenRouter, or local Ollama) directly. Faster (~1–2s) and creates zero background sessions in Paseo or any underlying CLI.
- **Instant local engine**: Works offline with zero API keys by analyzing errors, proposed plans, modified files, and uncommitted diffs to suggest context-aware next steps in Chinese or English.

## Controls

- Automatic suggestions after every completed turn (skips background subagents by default), with a per-session ON/OFF toggle right inside the `✨ Next` composer popover (and Command Center).
- Slash command `/next` to generate suggestions on demand.
- Settings screen (`Next Prompts`) to switch engines, pick presets, configure model and API key, and test the LLM connection.
