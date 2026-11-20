Next Prompts 在 Agent 完成一轮回复后自动推荐可点击的下一步提示词，并提供一键提示词优化功能，无需修改 `AGENTS.md`，也不会替换 Paseo 原生 Markdown 渲染。

## 工作原理

当任意 Agent 回合结束且进入空闲状态并产出回复后，插件会读取近期对话回合、部分工具调用详情以及当前工作区 `git status`，并将下一步建议展示在输入框气泡（`Next`）、时间线卡片或两者中。点击建议可直接填入输入框或发送；也可通过弹窗或 `/enhance` 命令原地优化草稿提示词。

## 生成模式与配置

- **临时后台会话（默认）**：直接复用你已配置的 Paseo AI Provider（如 Codex、Cursor、Claude、OpenCode、Copilot 等），在当前 Workspace 内创建隐藏辅助 Agent 并在完成后自动归档，无需额外配置 API Key。
- **LLM API 直连模式**：直接向 OpenAI 兼容 HTTP 接口（如 OpenAI、DeepSeek、OpenRouter、自定义端点或本地 Ollama）发送请求。在 **Next Prompts** 设置页中配置 API Base URL、模型名与 API Key。每个已保存的 API Key 均与对应的端点 URL 严格绑定；守护进程环境变量 `OPENAI_API_KEY` 仅用于 `https://api.openai.com`，`PASEO_NEXT_PROMPTS_API_KEY` 仅在 `PASEO_NEXT_PROMPTS_API_BASE_URL` 与当前配置端点一致时生效。本地端点（`localhost`、`127.0.0.1`、`[::1]`）无需 API Key 即可使用。
- **自动模式**：当前端点已配置 Key 或为本地端点时优先使用 LLM API 直连，否则依次回退至临时后台会话与本地上下文引擎。
- **本地上下文模式**：仅在守护进程本机运行规则分析，不调用外部模型。

需要 Paseo `>=0.16.0`。插件配置保存在本机 `~/.paseo/next-prompts-config.json`（或 `$PASEO_HOME/next-prompts-config.json`）。

## 数据与隐私

在模型生成模式（**临时后台会话**、**LLM API 直连模式**，以及触发模型调用的**自动模式**）下，生成下一步建议会将以下内容发送给所选的 Paseo Provider 或配置的模型接口端点：

- 近期对话文本（最近一轮用户输入、最新助手回复，以及最多前两轮对话的简短摘录）。
- 部分工具调用详情（本轮使用的工具名称、未完成待办事项、未解决的失败命令字符串，以及回合报错或失败命令输出摘录）。
- 工作区文件名（工具调用中编辑/写入的文件路径，以及 `git status` 中的已修改与未跟踪文件名）。

提示词优化功能会将输入框草稿、最近一条助手回复摘录以及 `git status` 中的变更文件名发送给所选 Provider 或接口端点。

**本地上下文模式**仅在守护进程本机处理，不会将对话文本、工具详情或文件名发送至外部服务商。

## 控制与入口

- 在输入框旁的 `Next` 弹窗顶部或 Command Center（`Next Prompts: 切换当前会话自动推荐`）可单独开启/暂停当前会话的自动推荐（默认跳过后台子 Agent）。
- 斜杠命令 `/next` 手动生成或刷新建议，`/enhance <草稿>` 优化草稿提示词。
- 在 **Next Prompts** 设置页切换生成模式、展示位置、服务商预设、界面与输出语言（自动 / 中文 / English），并测试模型接口连通性。
