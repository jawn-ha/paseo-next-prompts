Next Prompts automatically suggests clickable follow-up prompts right below every completed agent turn, without modifying AGENTS.md or replacing native Markdown rendering.

## How it works

When an agent finishes a turn, the plugin inspects the latest user request, assistant reply, tool outcomes, and workspace `git status`. It then appends a compact suggestion card directly below the reply. Click any suggestion to send it immediately, or click the edit icon to load it into the composer input before sending.

## Dual engines

- **Auto mode (default)**: Uses a fast OpenAI-compatible LLM (OpenAI, DeepSeek, OpenRouter, or local Ollama) when configured, and falls back to the instant local engine otherwise.
- **Instant local engine**: Works offline with zero API keys by analyzing errors, proposed plans, modified files, and uncommitted diffs to suggest context-aware next steps in Chinese or English.

## Controls

- Automatic suggestions after every completed turn (skips background subagents by default).
- Slash command `/next` to generate suggestions on demand.
- Settings screen (`Next Prompts`) to switch engines, pick presets, configure model and API key, and test the LLM connection.
