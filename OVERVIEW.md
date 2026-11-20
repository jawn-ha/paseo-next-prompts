Next Prompts suggests clickable follow-up prompts after an agent completes a turn and provides one-click prompt rewriting, without modifying `AGENTS.md` or replacing Paseo's native Markdown rendering.

## How it works

When an agent finishes a turn and becomes idle with a reply, the plugin reads recent conversation turns, selected tool details, and workspace `git status`. It publishes follow-up suggestions to the composer popover (`Next`), the chat timeline, or both. Clicking a suggestion fills or sends it; the popover and `/enhance` command can also rewrite a draft prompt in place.

## Generation modes and setup

- **Background session (default)**: Reuses a configured Paseo AI provider (such as Codex, Cursor, Claude, OpenCode, or Copilot) by running a hidden helper agent in the current workspace and archiving it when finished. No separate API key is required.
- **Direct LLM API**: Sends chat-completion requests directly to an OpenAI-compatible HTTP endpoint (OpenAI, DeepSeek, OpenRouter, custom endpoints, or local Ollama). Configure the API Base URL, model name, and API key in **Next Prompts** settings. Each stored API key is tied to its configured endpoint URL. `OPENAI_API_KEY` from the daemon environment is used only with `https://api.openai.com`; `PASEO_NEXT_PROMPTS_API_KEY` is used only when `PASEO_NEXT_PROMPTS_API_BASE_URL` matches the configured endpoint. Local endpoints (`localhost`, `127.0.0.1`, `[::1]`) work without an API key.
- **Auto**: Uses Direct LLM API when a key is configured for the active endpoint (or the endpoint is local), then falls back to Background session, then Local context.
- **Local context**: Generates rule-based suggestions locally on the daemon host without calling a model.

Requires Paseo `>=0.16.0`. Settings are stored locally at `~/.paseo/next-prompts-config.json` (or `$PASEO_HOME/next-prompts-config.json`).

## Data and privacy

In model modes (**Background session**, **Direct LLM API**, and **Auto** when a model is used), follow-up suggestion generation sends the following context to the selected Paseo provider or configured API endpoint:

- Recent chat text (the latest user request, latest assistant reply, and short excerpts of up to two prior turns).
- Selected tool details (tool names used, pending todo items, unresolved failed shell command strings, and turn error or command-output excerpts).
- Workspace filenames (edited/written file paths from tool calls and modified or untracked filenames from `git status`).

Prompt optimization sends your draft text, a short excerpt of the latest assistant reply, and modified or untracked filenames from `git status` to the selected provider or endpoint.

The **Local context** mode runs only on the daemon host and does not send chat text, tool details, or filenames to external providers.

## Controls

- Per-session auto-suggest toggle inside the `Next` composer popover and Command Center (`Next Prompts: Toggle Auto-Suggest for Current Session`). Background subagents are skipped by default.
- Slash commands `/next` (generate or refresh suggestions) and `/enhance <draft>` (rewrite a rough prompt).
- **Next Prompts** settings screen to pick the generation mode, display position, provider or endpoint preset, language (`Auto`, English, or Simplified Chinese), and run a connection test.
