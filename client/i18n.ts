import { defineTranslations, useTranslation } from "@getpaseo/plugin/client";
import type { NextPromptsLanguage } from "../shared/contracts";

const en = {
  // Registrations (index.client.tsx)
  pillTitle: "Optimize current prompt or pick next follow-up prompt",
  pillLabel: "Next",
  settingsTitle: "Next Prompts",
  cmdSettings: "Next Prompts: Settings",
  cmdToggleSession: "Next Prompts: Toggle Auto-Suggest for Current Session",
  cmdOptimize: "Next Prompts: Optimize Current Input",
  slashNextDesc: "Generate follow-up prompt suggestions for the current turn",
  slashEnhanceDesc: "Optimize a rough prompt and fill it into the chat input box",
  slashEnhanceHint: "<your rough prompt>",

  // Popover
  popoverTitle: "✨ Next Prompts",
  sessionAutoOn: "Auto",
  sessionAutoOff: "Paused",
  sessionToggleLabel: "Auto-suggest for current session",
  openSettingsLabel: "Open Next Prompts settings",
  settingsModalTitle: "Next Prompts Settings",
  optimizing: "✨ Optimizing...",
  optimizeDraft: "✨ Optimize Current Input",
  optimizePlaceholder: "Type a draft to optimize your prompt",
  undo: "↩ Undo",
  clear: "Clear",
  suggestionsHeading: "Follow-up Suggestions",
  refreshing: "Generating...",
  refresh: "↻ Refresh",
  emptyPaused:
    "Auto-suggest is paused for this session (other sessions unaffected).\nClick ↻ Refresh anytime to generate manually.",
  emptyDefault: "No suggestions yet. Complete a turn or click ↻ Refresh.",
  emptyDraftError: "Please type something in the chat box first",
  optimizeFailed: "Prompt optimization failed",
  optimizedAiToast: "Prompt optimized with {{model}}",
  optimizedLocalToast: "Prompt optimized (local mode)",
  sessionDisabledToast: "Auto-suggest paused for this session only",
  sessionEnabledToast: "Auto-suggest enabled for this session",
  engineLocal: "Local · Context",

  // Timeline card
  timelineTitle: "✨ Next Prompts",
  timelineRefresh: "↻ Refresh",
  timelineRefreshing: "...",
  timelineEditHint: "Edit in composer",

  // Settings screen
  settingsHeading: "✨ Next Prompts",
  settingsSubtitle:
    "Automatically suggests clickable follow-up prompts after every agent turn. Supports zero-key background sessions, fast Direct LLM APIs, and an instant local engine.",
  generalBehavior: "General Behavior",
  autoSuggestOn: "✓ Auto-suggest after turn: ON",
  autoSuggestOff: "Auto-suggest after turn: OFF",
  skipBgOn: "✓ Skip background subagents",
  skipBgOff: "Include background subagents",
  displayPosition: "Display Position",
  displayComposer: "Chat Box (Codex-style)",
  displayTimeline: "Timeline Card",
  displayBoth: "Both",
  generationMode: "Generation Mode",
  modePaseo: "Background Session (Auto-Archive · Default)",
  modeLlm: "Direct LLM API (Base URL / Key)",
  modeAuto: "Auto (Direct LLM → Background Session → Local)",
  modeHeuristic: "Local Context Only (0ms)",
  tipTitle: "Tip: Background Session vs. Direct LLM API",
  tipPaseoPrefix: "Background Session (Auto-Archive · Default)",
  tipPaseoBody:
    ": Zero extra API key — reuses your existing Paseo AI provider in a temporary background agent inside the current workspace (no new workspace created) and automatically archives it when done. Slightly slower (~5–15s) and may still appear in the underlying CLI's local history.",
  tipLlmPrefix: "Direct LLM API (Base URL / Key)",
  tipLlmBody:
    ": Sends a direct HTTP request to an OpenAI-compatible endpoint (OpenAI / DeepSeek / OpenRouter / local Ollama). Faster (~1–2s) and creates zero background sessions in Paseo or any CLI, but requires configuring a Base URL, Model, and API Key.",
  paseoProviderTitle: "Paseo AI Provider (Temporary Background Session · Auto-Archived)",
  paseoProviderAuto: "Auto (Match Agent)",
  paseoProviderPlaceholder: "auto or provider / provider/model",
  suggestionsPerTurn: "Suggestions per turn",
  languageLabel: "Language (UI & Suggestions)",
  langAuto: "Auto",
  langZh: "中文",
  langEn: "English",
  directLlmTitle: "Direct LLM API (OpenAI-Compatible / Ollama)",
  directLlmDesc:
    "Calls the HTTP endpoint directly without spawning any Paseo background session (or set OPENAI_API_KEY / PASEO_NEXT_PROMPTS_API_KEY in the daemon env).",
  presetOllama: "Ollama (Local)",
  apiBaseUrl: "API Base URL",
  modelLabel: "Model",
  apiKeyLabel: "API Key",
  apiKeySaved: "(Saved: {{preview}})",
  apiKeyNotSet: "(Not set)",
  apiKeyPlaceholderReplace: "Enter a new key to replace, or leave blank to keep current",
  apiKeyPlaceholderNew: "sk-... (optional for local Ollama)",
  saveSettings: "Save Settings",
  saving: "Saving...",
  testLlm: "Test LLM",
  testing: "Testing...",
  clearKey: "Clear Key",
  savedToast: "Saved Next Prompts settings",
  testOkToast: "LLM OK ({{model}}) — generated {{count}} suggestions in {{ms}}ms",
  testFailedToast: "LLM Test Failed: {{error}}",
} as const;

const zh: Record<keyof typeof en, string> = {
  // Registrations (index.client.tsx)
  pillTitle: "优化当前输入或选择下一步推荐追问",
  pillLabel: "Next",
  settingsTitle: "Next Prompts",
  cmdSettings: "Next Prompts: 打开设置",
  cmdToggleSession: "Next Prompts: 切换当前会话自动推荐",
  cmdOptimize: "Next Prompts: 一键优化当前输入",
  slashNextDesc: "为当前对话回合生成下一步追问建议",
  slashEnhanceDesc: "优化草稿提示词并回填到输入框",
  slashEnhanceHint: "<你的草稿提示词>",

  // Popover
  popoverTitle: "✨ Next Prompts",
  sessionAutoOn: "自动推荐",
  sessionAutoOff: "本会话已关",
  sessionToggleLabel: "当前会话自动推荐",
  openSettingsLabel: "打开 Next Prompts 设置",
  settingsModalTitle: "Next Prompts 设置",
  optimizing: "✨ 优化中...",
  optimizeDraft: "✨ 一键优化当前输入",
  optimizePlaceholder: "输入内容后可一键优化 Prompt",
  undo: "↩ 撤销",
  clear: "清空",
  suggestionsHeading: "推荐追问",
  refreshing: "生成中...",
  refresh: "↻ 换一批",
  emptyPaused:
    "当前会话已关闭自动推荐（不影响其他会话）\n仍可随时点右上角「↻ 换一批」手动生成",
  emptyDefault: "暂无建议，完成一轮对话或点右上角「↻ 换一批」生成",
  emptyDraftError: "请先在聊天输入框里输入一点内容再优化",
  optimizeFailed: "提示词优化失败",
  optimizedAiToast: "已用 {{model}} 优化提示词",
  optimizedLocalToast: "已优化提示词（本地模式）",
  sessionDisabledToast: "已关闭当前会话的自动推荐（仅影响本会话）",
  sessionEnabledToast: "已开启当前会话的自动推荐",
  engineLocal: "本地 · 上下文",

  // Timeline card
  timelineTitle: "✨ 下一步推荐",
  timelineRefresh: "↻ 换一批",
  timelineRefreshing: "...",
  timelineEditHint: "填入输入框编辑",

  // Settings screen
  settingsHeading: "✨ Next Prompts",
  settingsSubtitle:
    "每轮 Agent 回复结束后自动推荐可点击的下一步追问。支持零 Key 临时后台会话、高速直连 LLM API 与离线本地引擎。",
  generalBehavior: "通用设置",
  autoSuggestOn: "✓ 回合结束后自动推荐：开",
  autoSuggestOff: "回合结束后自动推荐：关",
  skipBgOn: "✓ 跳过后台子 Agent",
  skipBgOff: "包含后台子 Agent",
  displayPosition: "展示位置",
  displayComposer: "输入框气泡（Codex 风格）",
  displayTimeline: "时间线卡片",
  displayBoth: "两者都显示",
  generationMode: "生成模式",
  modePaseo: "临时后台会话（自动归档 · 默认）",
  modeLlm: "LLM API 直连模式（Base URL / Key）",
  modeAuto: "自动（API 直连 → 后台会话 → 本地）",
  modeHeuristic: "仅本地上下文引擎（0ms）",
  tipTitle: "提示：临时后台会话 vs. LLM API 直连模式",
  tipPaseoPrefix: "临时后台会话（自动归档 · 默认）",
  tipPaseoBody:
    "：无需额外 API Key，直接复用你已配置的 Paseo AI Provider，在当前 Workspace 内创建隐藏后台 Agent 并在完成后自动归档（不新建 Workspace）。响应略慢（约 5–15 秒），底层 CLI 本地历史中可能留痕。",
  tipLlmPrefix: "LLM API 直连模式（Base URL / Key）",
  tipLlmBody:
    "：直接通过 HTTP 请求 OpenAI 兼容接口（OpenAI / DeepSeek / OpenRouter / 本地 Ollama）。响应更快（约 1–2 秒），在 Paseo 与底层 CLI 中完全不产生任何后台会话，但需要配置 Base URL、模型名与 API Key。",
  paseoProviderTitle: "Paseo AI Provider（当前 Workspace 临时后台会话 · 自动归档）",
  paseoProviderAuto: "自动（跟随当前会话）",
  paseoProviderPlaceholder: "auto 或 provider / provider/model",
  suggestionsPerTurn: "每轮建议数量",
  languageLabel: "语言（界面与推荐内容）",
  langAuto: "自动 (Auto)",
  langZh: "中文",
  langEn: "English",
  directLlmTitle: "LLM API 直连配置（OpenAI 兼容 / Ollama）",
  directLlmDesc:
    "直接通过 HTTP 调用模型接口，不创建任何 Paseo 后台会话（也可在 daemon 环境变量中设置 OPENAI_API_KEY 或 PASEO_NEXT_PROMPTS_API_KEY）。",
  presetOllama: "Ollama（本地）",
  apiBaseUrl: "API Base URL",
  modelLabel: "模型名称 (Model)",
  apiKeyLabel: "API Key",
  apiKeySaved: "（已保存：{{preview}}）",
  apiKeyNotSet: "（未设置）",
  apiKeyPlaceholderReplace: "输入新 Key 以替换，留空则保持当前 Key",
  apiKeyPlaceholderNew: "sk-...（本地 Ollama 可留空）",
  saveSettings: "保存设置",
  saving: "保存中...",
  testLlm: "测试连通性",
  testing: "测试中...",
  clearKey: "清除 Key",
  savedToast: "已保存 Next Prompts 设置",
  testOkToast: "LLM 连接正常（{{model}}）— 耗时 {{ms}}ms 生成 {{count}} 条建议",
  testFailedToast: "LLM 测试失败：{{error}}",
};

export const nextPromptsTranslations = defineTranslations({
  resources: {
    en,
    zh,
    "zh-CN": zh,
    "zh-Hans": zh,
  },
});

export type NextPromptsCopy = Record<keyof typeof en, string>;

export function resolveUiLanguage(
  preferred: NextPromptsLanguage | undefined,
  appLocale: string | undefined,
): "zh" | "en" {
  if (preferred === "zh" || preferred === "en") return preferred;
  const normalized = (appLocale || "").toLowerCase();
  return normalized.startsWith("zh") ? "zh" : "en";
}

export function formatCopy(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : "",
  );
}

export function useNextPromptsCopy(preferred?: NextPromptsLanguage): {
  lang: "zh" | "en";
  copy: NextPromptsCopy;
} {
  const { locale } = useTranslation(nextPromptsTranslations);
  const lang = resolveUiLanguage(preferred, locale);
  return {
    lang,
    copy: lang === "zh" ? zh : en,
  };
}
