Next Prompts 在每个 Agent 回合结束后自动推荐可点击的下一步提示词，无需修改 AGENTS.md，也不替换 Paseo 原生 Markdown 与代码高亮渲染。

## 工作原理

每当任意 Agent 完成一轮回复，插件会自动读取本轮对话、工具执行结果及当前工作区 `git status`，在回复正下方追加一张轻量级下一步建议卡片。点击卡片可直接发送给当前会话，点击右侧编辑图标可将提示词填入输入框微调后再发送。

## 生成模式

- **临时后台会话（自动归档 · 默认）**：无需额外配置 API Key，直接复用你已登录的 Paseo AI Provider（如 Codex、Cursor、Claude 等），在后台临时会话中生成建议，完成后自动归档 Agent 与对应 Workspace，不刷屏。
- **LLM API 直连模式（Base URL / Key）**：通过 HTTP 直接请求 OpenAI 兼容接口（支持 OpenAI、DeepSeek、OpenRouter 或本地 Ollama），响应更快（约 1–2 秒），且完全不产生任何后台会话或底层 CLI 会话记录。
- **零配置本地引擎**：无需 API Key、离线秒出，结合本轮报错、方案确认、修改文件与未提交 diff 自动生成中文或英文下一步建议。

## 使用入口

- 每轮任务结束后自动生成（默认跳过后台子 Agent）。
- 斜杠命令 `/next` 随时手动生成或刷新建议。
- 设置页（`Next Prompts`）可切换生成引擎、预设服务商、调整数量与语言，并一键测试模型连通性。
