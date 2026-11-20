import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  COMPOSER_METADATA_KEY,
  type NextPromptItem,
  type NextPromptsConfigPublic,
  type NextPromptsDisplayMode,
  type NextPromptsEngine,
  type NextPromptsLanguage,
  type NextPromptsMode,
  type NextPromptsTimelineData,
  SESSION_DISABLED_METADATA_KEY,
  type saveNextPromptsConfigRpc,
} from "../shared/contracts";

type PaseoServerApi = PluginHandlerContext["paseo"];

export { COMPOSER_METADATA_KEY, SESSION_DISABLED_METADATA_KEY };
export const HELPER_METADATA_KEY = "paseo-next-prompts-helper";

const generationSeqByAgent = new Map<string, number>();

function bumpAgentGeneration(agentId: string): number {
  const next = (generationSeqByAgent.get(agentId) ?? 0) + 1;
  generationSeqByAgent.set(agentId, next);
  return next;
}

export function invalidateAgentGeneration(agentId: string): void {
  bumpAgentGeneration(agentId);
}

export function isHelperAgent(agent: { metadata?: Record<string, unknown> | null }): boolean {
  return Boolean(agent.metadata?.[HELPER_METADATA_KEY]);
}

export function isSessionDisabled(agent: { metadata?: Record<string, unknown> | null }): boolean {
  return Boolean(agent.metadata?.[SESSION_DISABLED_METADATA_KEY]);
}

export async function setSessionAutoSuggestEnabled(
  paseo: PaseoServerApi,
  agentId: string,
  enabled: boolean,
): Promise<{ ok: boolean; disabled: boolean }> {
  if (!enabled) {
    invalidateAgentGeneration(agentId);
    await paseo.agents.ref(agentId).setMetadata({
      [SESSION_DISABLED_METADATA_KEY]: true,
      [COMPOSER_METADATA_KEY]: null,
    });
    return { ok: true, disabled: true };
  }
  await paseo.agents.ref(agentId).setMetadata({
    [SESSION_DISABLED_METADATA_KEY]: null,
  });
  return { ok: true, disabled: false };
}

interface StoredConfig {
  enabled: boolean;
  mode: NextPromptsMode;
  displayMode: NextPromptsDisplayMode;
  maxSuggestions: number;
  language: NextPromptsLanguage;
  paseoProvider: string;
  apiBaseUrl: string;
  model: string;
  apiKeysByEndpoint: Record<string, string>;
  skipBackgroundAgents: boolean;
}

const DEFAULT_CONFIG: StoredConfig = {
  enabled: true,
  mode: "paseo",
  displayMode: "composer",
  maxSuggestions: 3,
  language: "auto",
  paseoProvider: "auto",
  apiBaseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiKeysByEndpoint: {},
  skipBackgroundAgents: true,
};

export function normalizeApiBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    const pathname = u.pathname.replace(/\/+$/, "");
    return `${u.origin.toLowerCase()}${pathname}`;
  } catch {
    return "";
  }
}

export function isOpenAiApiEndpoint(urlStr: string): boolean {
  try {
    const u = new URL(urlStr.trim());
    return (
      u.protocol === "https:" &&
      u.hostname.toLowerCase() === "api.openai.com" &&
      (u.port === "" || u.port === "443") &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}

export function isLocalEndpoint(urlStr: string): boolean {
  try {
    const u = new URL(urlStr.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

function buildChatCompletionsEndpoint(apiBaseUrl: string): string {
  const normalized = normalizeApiBaseUrl(apiBaseUrl);
  if (!normalized) {
    throw new Error("Invalid API Base URL: must be a valid http:// or https:// URL");
  }
  return `${normalized}/chat/completions`;
}

function getConfigPath(): string {
  const paseoHome = process.env.PASEO_HOME || path.join(os.homedir(), ".paseo");
  return path.join(paseoHome, "next-prompts-config.json");
}

function loadConfig(): StoredConfig {
  const filePath = getConfigPath();
  try {
    if (!fs.existsSync(filePath)) return { ...DEFAULT_CONFIG, apiKeysByEndpoint: {} };
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<StoredConfig> & {
      apiKey?: unknown;
    };
    const hasExplicitBaseUrl = typeof raw.apiBaseUrl === "string" && raw.apiBaseUrl.trim().length > 0;
    const normalizedExplicitBaseUrl = hasExplicitBaseUrl ? normalizeApiBaseUrl(raw.apiBaseUrl!) : "";
    const apiBaseUrl = normalizedExplicitBaseUrl || DEFAULT_CONFIG.apiBaseUrl;

    const apiKeysByEndpoint: Record<string, string> = {};
    if (raw.apiKeysByEndpoint && typeof raw.apiKeysByEndpoint === "object" && !Array.isArray(raw.apiKeysByEndpoint)) {
      for (const [rawEndpoint, rawKey] of Object.entries(raw.apiKeysByEndpoint)) {
        const normalizedEndpoint = normalizeApiBaseUrl(rawEndpoint);
        if (normalizedEndpoint && typeof rawKey === "string" && rawKey.trim()) {
          apiKeysByEndpoint[normalizedEndpoint] = rawKey.trim();
        }
      }
    }

    // Legacy migration: bind any previous top-level apiKey strictly to its original apiBaseUrl
    if (
      typeof raw.apiKey === "string" &&
      raw.apiKey.trim() &&
      (!hasExplicitBaseUrl || Boolean(normalizedExplicitBaseUrl)) &&
      !apiKeysByEndpoint[apiBaseUrl]
    ) {
      apiKeysByEndpoint[apiBaseUrl] = raw.apiKey.trim();
    }

    return {
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_CONFIG.enabled,
      mode:
        raw.mode === "auto" || raw.mode === "paseo" || raw.mode === "llm" || raw.mode === "heuristic"
          ? raw.mode
          : DEFAULT_CONFIG.mode,
      displayMode:
        raw.displayMode === "composer" || raw.displayMode === "timeline" || raw.displayMode === "both"
          ? raw.displayMode
          : DEFAULT_CONFIG.displayMode,
      maxSuggestions:
        typeof raw.maxSuggestions === "number" && raw.maxSuggestions >= 1 && raw.maxSuggestions <= 5
          ? Math.round(raw.maxSuggestions)
          : DEFAULT_CONFIG.maxSuggestions,
      language:
        raw.language === "auto" || raw.language === "zh" || raw.language === "en"
          ? raw.language
          : DEFAULT_CONFIG.language,
      paseoProvider:
        typeof raw.paseoProvider === "string" && raw.paseoProvider.trim()
          ? raw.paseoProvider.trim()
          : DEFAULT_CONFIG.paseoProvider,
      apiBaseUrl,
      model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : DEFAULT_CONFIG.model,
      apiKeysByEndpoint,
      skipBackgroundAgents:
        typeof raw.skipBackgroundAgents === "boolean"
          ? raw.skipBackgroundAgents
          : DEFAULT_CONFIG.skipBackgroundAgents,
    };
  } catch {
    return { ...DEFAULT_CONFIG, apiKeysByEndpoint: {} };
  }
}

function writeConfig(cfg: StoredConfig): void {
  const filePath = getConfigPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

function resolveEffectiveApiKey(cfg: StoredConfig): string {
  const endpointKey = normalizeApiBaseUrl(cfg.apiBaseUrl);
  if (!endpointKey) return "";

  const stored = cfg.apiKeysByEndpoint[endpointKey]?.trim();
  if (stored) return stored;

  const envPluginKey = process.env.PASEO_NEXT_PROMPTS_API_KEY?.trim();
  const envPluginBaseUrl = process.env.PASEO_NEXT_PROMPTS_API_BASE_URL?.trim();
  if (envPluginKey && envPluginBaseUrl && normalizeApiBaseUrl(envPluginBaseUrl) === endpointKey) {
    return envPluginKey;
  }

  if (isOpenAiApiEndpoint(endpointKey)) {
    return process.env.OPENAI_API_KEY?.trim() || "";
  }

  return "";
}

function canUseDirectLlm(cfg: StoredConfig): boolean {
  return Boolean(resolveEffectiveApiKey(cfg)) || isLocalEndpoint(cfg.apiBaseUrl);
}

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function toPublicConfig(cfg: StoredConfig): NextPromptsConfigPublic {
  const effectiveKey = resolveEffectiveApiKey(cfg);
  return {
    enabled: cfg.enabled,
    mode: cfg.mode,
    displayMode: cfg.displayMode,
    maxSuggestions: cfg.maxSuggestions,
    language: cfg.language,
    paseoProvider: cfg.paseoProvider,
    apiBaseUrl: cfg.apiBaseUrl,
    model: cfg.model,
    hasApiKey: Boolean(effectiveKey),
    apiKeyPreview: effectiveKey ? maskKey(effectiveKey) : "",
    skipBackgroundAgents: cfg.skipBackgroundAgents,
  };
}

export function getPublicConfig(): NextPromptsConfigPublic {
  return toPublicConfig(loadConfig());
}

export function savePublicConfig(
  input: RpcInput<typeof saveNextPromptsConfigRpc>,
): NextPromptsConfigPublic {
  const cfg = loadConfig();
  if (typeof input.enabled === "boolean") cfg.enabled = input.enabled;
  if (input.mode) cfg.mode = input.mode;
  if (input.displayMode) cfg.displayMode = input.displayMode;
  if (typeof input.maxSuggestions === "number") cfg.maxSuggestions = input.maxSuggestions;
  if (input.language) cfg.language = input.language;
  if (typeof input.paseoProvider === "string" && input.paseoProvider.trim()) {
    cfg.paseoProvider = input.paseoProvider.trim();
  }
  if (typeof input.apiBaseUrl === "string" && input.apiBaseUrl.trim()) {
    const normalizedUrl = normalizeApiBaseUrl(input.apiBaseUrl);
    if (!normalizedUrl) {
      throw new Error("Invalid API Base URL: must be a valid http:// or https:// URL");
    }
    cfg.apiBaseUrl = normalizedUrl;
  }
  if (typeof input.model === "string" && input.model.trim()) cfg.model = input.model.trim();
  const endpointKey = normalizeApiBaseUrl(cfg.apiBaseUrl);
  if (endpointKey) {
    if (input.clearApiKey) {
      delete cfg.apiKeysByEndpoint[endpointKey];
    } else if (typeof input.apiKey === "string" && input.apiKey.trim()) {
      cfg.apiKeysByEndpoint[endpointKey] = input.apiKey.trim();
    }
  }
  if (typeof input.skipBackgroundAgents === "boolean") {
    cfg.skipBackgroundAgents = input.skipBackgroundAgents;
  }
  writeConfig(cfg);
  return toPublicConfig(cfg);
}

interface TurnSnapshot {
  previousTurnsSummary: string;
  userText: string;
  assistantText: string;
  pendingTodos: string[];
  editedFiles: string[];
  readFiles: string[];
  failedCommands: string[];
  unresolvedFailedCommand: string | null;
  toolNames: string[];
  turnFailed: boolean;
  hadError: boolean;
  errorMessage: string;
  gitModifiedFiles: string[];
  gitUntrackedFiles: string[];
  hasUncommittedChanges: boolean;
  resolvedCwd: string | null;
  resolvedProvider: string | null;
  resolvedWorkspaceId: string | null;
}

function execGitShort(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    if (!cwd || !fs.existsSync(cwd)) {
      resolve("");
      return;
    }
    execFile("git", args, { cwd, encoding: "utf8", timeout: 3000, maxBuffer: 512 * 1024 }, (err, out) => {
      resolve(err ? "" : out);
    });
  });
}

async function readGitContext(cwd?: string | null): Promise<{
  modified: string[];
  untracked: string[];
}> {
  if (!cwd) return { modified: [], untracked: [] };
  const status = await execGitShort(cwd, ["status", "--short"]);
  if (!status.trim()) return { modified: [], untracked: [] };
  const modified: string[] = [];
  const untracked: string[] = [];
  for (const line of status.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2);
    const file = line.slice(3).trim();
    if (!file) continue;
    if (code === "??") untracked.push(file);
    else modified.push(file);
  }
  return { modified: modified.slice(0, 12), untracked: untracked.slice(0, 8) };
}

function detectLanguage(cfgLang: NextPromptsLanguage, userText: string, assistantText: string): "zh" | "en" {
  if (cfgLang === "zh" || cfgLang === "en") return cfgLang;
  const userCjk = (userText.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (userCjk >= 2) return "zh";
  const sample = `${userText}\n${assistantText.slice(0, 800)}`;
  const cjkCount = (sample.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return cjkCount >= 4 ? "zh" : "en";
}

function extractTextFromTimelineItem(item: Record<string, any>): string {
  if (typeof item.text === "string") return item.text;
  if (typeof item.message === "string") return item.message;
  if (Array.isArray(item.content)) {
    return item.content
      .map((part: Record<string, any>) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

async function extractTurnSnapshot(
  paseo: PaseoServerApi,
  agentId: string,
  turnId?: string | null,
  cwd?: string | null,
  provider?: string | null,
  turnFailed = false,
  workspaceId?: string | null,
): Promise<TurnSnapshot | null> {
  let page = await paseo.agents.ref(agentId).timeline.refetch({
    direction: "tail",
    limit: 6,
    wholeTurns: true,
  });

  let entries = Array.isArray((page as any)?.entries) ? ((page as any).entries as Array<Record<string, any>>) : [];
  const hasAnyMessage = (list: Array<Record<string, any>>) =>
    list.some((e) => {
      const item = (e.item ?? e) as Record<string, any>;
      if (item?.type !== "user_message" && item?.type !== "assistant_message") return false;
      return extractTextFromTimelineItem(item).trim().length > 0;
    });

  if (!hasAnyMessage(entries)) {
    const fallbackPage = await paseo.agents.ref(agentId).timeline.refetch({
      direction: "tail",
      limit: 40,
    }).catch(() => null);
    const fallbackEntries = Array.isArray((fallbackPage as any)?.entries)
      ? ((fallbackPage as any).entries as Array<Record<string, any>>)
      : [];
    if (fallbackEntries.length > 0) {
      page = fallbackPage ?? page;
      entries = fallbackEntries;
    }
  }
  if (entries.length === 0) return null;

  // Group entries by turnId while preserving chronological order
  const turnOrder: string[] = [];
  const byTurn = new Map<string, Array<Record<string, any>>>();
  let syntheticIdx = 0;

  for (const entry of entries) {
    const key =
      typeof entry.turnId === "string" && entry.turnId.trim()
        ? entry.turnId
        : `__anon_${syntheticIdx}`;
    const item = (entry.item ?? entry) as Record<string, any>;
    if (!entry.turnId && item?.type === "user_message" && byTurn.has(key)) {
      syntheticIdx += 1;
    }
    const finalKey =
      typeof entry.turnId === "string" && entry.turnId.trim()
        ? entry.turnId
        : `__anon_${syntheticIdx}`;
    if (!byTurn.has(finalKey)) {
      byTurn.set(finalKey, []);
      turnOrder.push(finalKey);
    }
    byTurn.get(finalKey)!.push(entry);
  }

  const hasConversationText = (turnEntries: Array<Record<string, any>>): boolean =>
    turnEntries.some((e) => {
      const item = (e.item ?? e) as Record<string, any>;
      if (item?.type !== "user_message" && item?.type !== "assistant_message") return false;
      return extractTextFromTimelineItem(item).trim().length > 0;
    });

  let targetTurnKey: string | undefined =
    turnId && byTurn.has(turnId) && hasConversationText(byTurn.get(turnId)!)
      ? turnId
      : undefined;
  if (!targetTurnKey) {
    for (let i = turnOrder.length - 1; i >= 0; i -= 1) {
      const key = turnOrder[i];
      if (hasConversationText(byTurn.get(key) ?? [])) {
        targetTurnKey = key;
        break;
      }
    }
  }
  if (!targetTurnKey) {
    targetTurnKey = turnOrder[turnOrder.length - 1];
  }
  const activeEntries = byTurn.get(targetTurnKey) ?? entries;

  // Build concise summary of up to 2 prior turns for broader context
  const priorKeys = turnOrder.filter((k) => k !== targetTurnKey).slice(-2);
  const priorSummaries: string[] = [];
  for (const pk of priorKeys) {
    const pEntries = byTurn.get(pk) ?? [];
    let pUser = "";
    let pAssistant = "";
    for (const e of pEntries) {
      const item = (e.item ?? e) as Record<string, any>;
      if (item?.type === "user_message") {
        const t = extractTextFromTimelineItem(item).trim();
        if (t) pUser = pUser ? `${pUser} ${t}` : t;
      } else if (item?.type === "assistant_message") {
        const t = extractTextFromTimelineItem(item).trim();
        if (t) pAssistant = t;
      }
    }
    if (pUser || pAssistant) {
      const parts: string[] = [];
      if (pUser) parts.push(`User: ${pUser.slice(0, 260)}`);
      if (pAssistant) parts.push(`Agent: ${pAssistant.slice(-360)}`);
      priorSummaries.push(parts.join("\n"));
    }
  }

  const userParts: string[] = [];
  const assistantParts: string[] = [];
  const toolNames: string[] = [];
  const editedFiles: string[] = [];
  const readFiles: string[] = [];
  const failedCommands: string[] = [];
  let latestTodos: string[] = [];
  let hadError = turnFailed;
  let errorMessage = "";
  let lastFailedCommand: string | null = null;
  let hadSuccessAfterLastFailure = false;

  for (const entry of activeEntries) {
    const item = (entry.item ?? entry) as Record<string, any>;
    if (!item || typeof item !== "object") continue;
    if (item.type === "user_message") {
      const t = extractTextFromTimelineItem(item).trim();
      if (t) userParts.push(t);
    } else if (item.type === "assistant_message") {
      const t = extractTextFromTimelineItem(item).trim();
      if (t) assistantParts.push(t);
    } else if (item.type === "todo" && Array.isArray(item.items)) {
      latestTodos = item.items
        .filter((t: Record<string, any>) => !t?.completed && t?.status !== "completed" && typeof t?.text === "string")
        .map((t: Record<string, any>) => t.text.trim())
        .filter(Boolean);
    } else if (item.type === "tool_call") {
      if (typeof item.name === "string") toolNames.push(item.name);
      const detail = item.detail as Record<string, any> | undefined;
      if (detail && typeof detail === "object") {
        if ((detail.type === "edit" || detail.type === "write") && typeof detail.filePath === "string") {
          editedFiles.push(detail.filePath);
        } else if (detail.type === "read" && typeof detail.filePath === "string") {
          readFiles.push(detail.filePath);
        } else if (detail.type === "shell" && typeof detail.command === "string") {
          const failed =
            item.status === "failed" ||
            (typeof detail.exitCode === "number" && detail.exitCode !== 0);
          if (failed) {
            const cmd = detail.command.trim().slice(0, 120);
            failedCommands.push(cmd);
            lastFailedCommand = cmd;
            hadSuccessAfterLastFailure = false;
            hadError = true;
            if (!errorMessage && typeof detail.output === "string" && detail.output.trim()) {
              errorMessage = detail.output.trim().slice(-300);
            }
          } else if (item.status === "completed") {
            hadSuccessAfterLastFailure = true;
          }
        }
      }
      if (item.status === "failed" || item.error) {
        hadError = true;
        if (!errorMessage && item.error) {
          errorMessage = typeof item.error === "string" ? item.error : JSON.stringify(item.error);
        }
      }
    } else if (item.type === "error") {
      hadError = true;
      errorMessage = extractTextFromTimelineItem(item);
    }
  }

  const userText = userParts.join("\n").trim();
  const assistantText = assistantParts.join("\n").trim();
  if (!userText && !assistantText) return null;

  const pageAgent = (page as any)?.agent as Record<string, any> | undefined;
  const resolvedCwd = cwd || pageAgent?.cwd || null;
  let resolvedWorkspaceId =
    workspaceId ||
    (typeof pageAgent?.workspaceId === "string" ? pageAgent.workspaceId : null);
  if (!resolvedWorkspaceId) {
    const refreshed = await paseo.agents.ref(agentId).refresh().catch(() => null);
    if (refreshed?.agent?.workspaceId) {
      resolvedWorkspaceId = refreshed.agent.workspaceId;
    }
  }
  const resolvedProvider =
    provider ||
    pageAgent?.runtimeInfo?.provider ||
    pageAgent?.provider ||
    null;
  const git = await readGitContext(resolvedCwd);

  const unresolvedFailedCommand =
    lastFailedCommand && (turnFailed || !hadSuccessAfterLastFailure)
      ? lastFailedCommand
      : null;

  return {
    previousTurnsSummary: priorSummaries.join("\n---\n").slice(-1200),
    userText: userText.slice(-1400),
    assistantText: assistantText.slice(-3600),
    pendingTodos: Array.from(new Set(latestTodos)).slice(0, 6),
    editedFiles: Array.from(new Set(editedFiles)).slice(0, 10),
    readFiles: Array.from(new Set(readFiles)).slice(0, 10),
    failedCommands: Array.from(new Set(failedCommands)).slice(-4),
    unresolvedFailedCommand,
    toolNames: Array.from(new Set(toolNames)).slice(0, 12),
    turnFailed,
    hadError,
    errorMessage: errorMessage.slice(0, 400),
    gitModifiedFiles: git.modified,
    gitUntrackedFiles: git.untracked,
    hasUncommittedChanges: git.modified.length + git.untracked.length > 0,
    resolvedCwd,
    resolvedProvider,
    resolvedWorkspaceId,
  };
}

function cleanSnippet(text: string): string {
  return text
    .replace(/\*\*|__|`/g, "")
    .replace(/^[-*•\d.)\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateLabel(text: string, maxLen = 28): string {
  const clean = cleanSnippet(text).replace(/[。？！?!.,，；;:：]+$/, "");
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

function extractOffersFromReply(reply: string, lang: "zh" | "en"): string[] {
  const results: string[] = [];
  const tail = reply.slice(-1800);

  if (lang === "zh") {
    const patterns = [
      /(?:如果你(?:需要|想|希望|愿意)|如需|如要)[，,、\s]*(?:我可以|我也可以|可以)?(?:帮你|为你|继续)?([^。？！?!\n]{4,70})/g,
      /(?:需要我|要不要我?|是否需要我?|我可以继续帮你|我可以帮你|接下来可以|还可以帮你)([^。？！?!\n]{4,70})/g,
    ];
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(tail)) !== null) {
        const candidate = cleanSnippet(m[1] ?? "");
        if (candidate.length >= 4 && !/^(吗|么|呢|了|一下)$/.test(candidate)) {
          results.push(candidate.replace(/[吗么呢]+$/, "").trim());
        }
      }
    }
  } else {
    const patterns = [
      /(?:would you like me to|want me to|shall i|i can also|next,?\s*i can|if you'd like,?\s*i can)\s+([^.?!\n]{6,90})/gi,
    ];
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(tail)) !== null) {
        const candidate = cleanSnippet(m[1] ?? "");
        if (candidate.length >= 6) results.push(candidate);
      }
    }
  }

  return Array.from(new Set(results)).slice(0, 3);
}

function extractConclusionSteps(reply: string): string[] {
  const lines = reply.split(/\r?\n/);
  const headingRe =
    /^(?:#{1,4}\s*)?(?:\*\*|__)?(下一步(?:计划|建议|操作)?|后续(?:步骤|建议|计划|安排)?|接下来|建议下一步|待办(?:事项)?|可选方案|next steps?|follow-?ups?|recommendations?|options?|todo|remaining)(?:\*\*|__)?[：:]?\s*(.*)$/i;

  const extracted: string[] = [];
  let inSection = false;
  let blankStreak = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      blankStreak += 1;
      if (blankStreak >= 2) inSection = false;
      continue;
    }
    blankStreak = 0;

    const headMatch = line.match(headingRe);
    if (headMatch) {
      inSection = true;
      const inlineBody = cleanSnippet(headMatch[2] ?? "");
      if (inlineBody.length >= 6 && inlineBody.length <= 220) {
        extracted.push(inlineBody);
      }
      continue;
    }

    if (inSection) {
      if (/^#{1,4}\s/.test(line) || /^\*\*[^*]{2,30}\*\*$/.test(line)) {
        inSection = false;
        continue;
      }
      const bulletMatch = line.match(/^(?:[-*•]|\d+[.)]|方案\s*[A-Za-z0-9][：:]?|Option\s*[A-Za-z0-9][：:]?)\s*(.+)$/);
      if (bulletMatch?.[1]) {
        const item = cleanSnippet(bulletMatch[1]);
        if (item.length >= 5 && item.length <= 200) {
          extracted.push(item);
        }
      } else {
        // Plain paragraph directly under "下一步" / "Next steps" heading!
        const para = cleanSnippet(line);
        if (para.length >= 8 && para.length <= 260) {
          extracted.push(para);
        }
      }
    }
  }

  // Also check explicit "方案 A / Option A" anywhere in the tail even without a section heading
  if (extracted.length === 0) {
    const tailLines = lines.slice(-24);
    for (const raw of tailLines) {
      const line = raw.trim();
      const optMatch = line.match(/^(?:[-*•]\s*)?(?:方案\s*[A-C1-3]|Option\s*[A-C1-3])[：:]\s*(.+)$/i);
      if (optMatch?.[1]) {
        const item = cleanSnippet(optMatch[1]);
        if (item.length >= 4 && item.length <= 140) extracted.push(item);
      }
    }
  }

  return Array.from(new Set(extracted)).slice(0, 4);
}

function extractMentionedFiles(snap: TurnSnapshot): string[] {
  const files: string[] = [
    ...snap.editedFiles,
    ...snap.gitModifiedFiles,
    ...snap.gitUntrackedFiles,
  ];

  // Also grab backticked file paths from the assistant's reply
  const matches = snap.assistantText.match(/`([a-zA-Z0-9_./-]+\.[a-zA-Z]{1,6})`/g) ?? [];
  for (const m of matches) {
    const f = m.slice(1, -1);
    if (!f.startsWith("http") && f.length <= 80) files.push(f);
  }

  return Array.from(new Set(files.map((f) => path.basename(f)))).slice(0, 4);
}

function extractMainTopic(snap: TurnSnapshot): string {
  const source = snap.userText || snap.assistantText;
  const firstLine = source
    .split(/\r?\n/)
    .map((l) => cleanSnippet(l))
    .find((l) => l.length >= 4 && !l.startsWith("```"));
  if (!firstLine) return "";
  return firstLine.length > 36 ? `${firstLine.slice(0, 35)}…` : firstLine;
}

function buildHeuristicSuggestions(
  snap: TurnSnapshot,
  lang: "zh" | "en",
  maxCount: number,
  previousPrompts: string[] = [],
): NextPromptItem[] {
  const candidates: NextPromptItem[] = [];
  const seenPrompts = new Set<string>();
  const pushCandidate = (label: string, prompt: string, reason?: string) => {
    const norm = prompt.trim();
    if (!norm || seenPrompts.has(norm)) return;
    seenPrompts.add(norm);
    candidates.push({
      id: `h-${candidates.length + 1}`,
      label: truncateLabel(label, 30),
      prompt: norm,
      reason,
    });
  };

  const mentionedFiles = extractMentionedFiles(snap);
  const codeFiles = mentionedFiles.filter((f) => !/\.(md|mdx|txt|rst|adoc|log)$/i.test(f));
  const fileHint = (codeFiles.length > 0 ? codeFiles : mentionedFiles).slice(0, 3).join(", ");
  const topic = extractMainTopic(snap);
  const offers = extractOffersFromReply(snap.assistantText, lang);
  const steps = extractConclusionSteps(snap.assistantText);
  const mentionsError =
    snap.turnFailed ||
    (!steps.length &&
      snap.unresolvedFailedCommand !== null) ||
    (!steps.length &&
      /\b(error|failed|exception|traceback|panic|exit code [1-9])\b/i.test(snap.assistantText.slice(-600)) &&
      !/全部通过|已通过|succeeded|预期拦截|expected/i.test(snap.assistantText.slice(-600)));
  const mentionsTest =
    /\b(test|jest|vitest|pytest|go test|typecheck|tsc)\b/i.test(snap.assistantText) ||
    /单测|测试|类型检查/.test(snap.assistantText);

  if (lang === "zh") {
    // 1. If the turn itself failed, prioritize fixing the failure
    if (snap.turnFailed && snap.unresolvedFailedCommand) {
      const cmd = snap.unresolvedFailedCommand;
      pushCandidate(
        `修复 ${truncateLabel(cmd, 18)} 报错`,
        `针对失败的命令 \`${cmd}\`，定位根因并直接修复，然后重新运行确认通过。`,
        "本轮执行失败",
      );
    }

    // 2. Explicit next-step / conclusion items from the agent's final reply (highest priority when turn succeeded!)
    for (const step of steps.slice(0, 2)) {
      pushCandidate(
        step,
        `围绕结论里的下一步继续推进：${step}`,
        "提取自上一轮「下一步」结论",
      );
    }

    // 3. Explicit offers/questions from the agent's conclusion
    for (const offer of offers.slice(0, 2)) {
      pushCandidate(
        offer,
        `好，请直接帮我${offer}，完成后简要汇报结果。`,
        "来自上一轮结论的后续建议",
      );
    }

    // 4. Pending todos from timeline
    for (const todo of snap.pendingTodos.slice(0, 2)) {
      pushCandidate(
        `继续：${todo}`,
        `继续完成剩余待办：「${todo}」，并在完成后做验证。`,
        "当前仍有未完成 Todo",
      );
    }

    // 5. Unresolved error fallback (only if no explicit next steps already explained the situation)
    if (!snap.turnFailed && mentionsError) {
      if (snap.unresolvedFailedCommand) {
        const cmd = snap.unresolvedFailedCommand;
        pushCandidate(
          `修复 ${truncateLabel(cmd, 18)} 报错`,
          `针对刚才失败的命令 \`${cmd}\`，定位根因并直接修复，然后重新运行确认通过。`,
          "检测到未恢复的命令失败",
        );
      } else {
        pushCandidate(
          "定位并修复上述报错",
          `定位上一轮提到的报错根因${fileHint ? `（重点看 ${fileHint}）` : ""}并直接修复，然后重新验证通过。`,
          "本轮结尾存在未解决报错",
        );
      }
    }

    // 5. File / git / topic-aware actions (also serves as pool for ↻ 换一批)
    if (codeFiles.length > 0) {
      if (!mentionsTest) {
        pushCandidate(
          `验证 ${codeFiles[0]} 改动`,
          `针对 ${fileHint} 的改动运行类型检查与相关测试，确认边界场景无回归。`,
          "已定位到相关代码文件改动",
        );
      }
      pushCandidate(
        `排查 ${codeFiles[0]} 边界情况`,
        `结合刚才的结论，检查 ${fileHint} 中的空值、异常流与并发边界情况，有隐患直接加固。`,
      );
    }

    if (snap.hasUncommittedChanges) {
      const total = snap.gitModifiedFiles.length + snap.gitUntrackedFiles.length;
      pushCandidate(
        "Review Diff 并提交",
        `审查当前 ${total} 个未提交改动文件（${fileHint || "工作区"}），确认没有遗漏或调试代码后生成规范 commit message 并提交。`,
        `工作区有 ${total} 个未提交改动`,
      );
    }

    if (topic) {
      pushCandidate(
        "按当前结论直接实现",
        `基于关于「${topic}」的分析结论，直接帮我把具体代码改动实现出来并完成验证。`,
      );
      pushCandidate(
        "梳理剩余风险与待办",
        `围绕「${topic}」的当前结论，列出最关键的潜在风险、未覆盖场景和后续待办 Checklist。`,
      );
    } else {
      pushCandidate(
        "把方案落地成代码",
        "基于上面的分析结论，直接帮我把具体代码改动实现出来并做验证。",
      );
      pushCandidate(
        "检查边界与风险点",
        "针对上面的结论，列出最容易踩坑的边界情况和潜在风险，并给出规避方案。",
      );
    }
    pushCandidate(
      "补充文档与使用说明",
      `结合刚才关于${fileHint || "本轮改动"}的结论，补充或更新对应的注释/文档，方便后续维护。`,
    );
  } else {
    if (snap.turnFailed && snap.unresolvedFailedCommand) {
      const cmd = snap.unresolvedFailedCommand;
      pushCandidate(
        `Fix \`${truncateLabel(cmd, 18)}\``,
        `Diagnose why \`${cmd}\` failed, apply the fix, and re-run it until it passes cleanly.`,
        "Command failed in the last turn",
      );
    }

    for (const step of steps.slice(0, 2)) {
      pushCandidate(
        step,
        `Proceed with the next step from your conclusion: ${step}`,
        "Extracted from agent's Next Steps",
      );
    }

    for (const offer of offers.slice(0, 2)) {
      pushCandidate(
        offer,
        `Yes, go ahead and ${offer}, then verify the changes and summarize what you did.`,
        "Follow-up offered in agent reply",
      );
    }

    for (const todo of snap.pendingTodos.slice(0, 2)) {
      pushCandidate(
        `Continue: ${todo}`,
        `Continue with the remaining todo: "${todo}", and verify once done.`,
        "Pending todo item",
      );
    }

    if (!snap.turnFailed && mentionsError) {
      if (snap.unresolvedFailedCommand) {
        const cmd = snap.unresolvedFailedCommand;
        pushCandidate(
          `Fix \`${truncateLabel(cmd, 18)}\``,
          `Diagnose why \`${cmd}\` failed, apply the fix, and re-run it until it passes cleanly.`,
          "Unresolved failed command",
        );
      } else {
        pushCandidate(
          "Fix the error & verify",
          `Diagnose the root cause of the error above${fileHint ? ` (focus on ${fileHint})` : ""}, apply the fix, and re-verify.`,
          "Detected unresolved error in the last turn",
        );
      }
    }

    if (codeFiles.length > 0) {
      if (!mentionsTest) {
        pushCandidate(
          `Test ${codeFiles[0]} changes`,
          `Run typecheck and tests covering ${fileHint} to verify the recent changes and edge cases.`,
          "Code files touched in this turn",
        );
      }
      pushCandidate(
        `Audit ${codeFiles[0]} edge cases`,
        `Audit ${fileHint} for null safety, error handling, and edge cases based on the conclusion above, and harden anything fragile.`,
      );
    }

    if (snap.hasUncommittedChanges) {
      const total = snap.gitModifiedFiles.length + snap.gitUntrackedFiles.length;
      pushCandidate(
        "Review diff & commit",
        `Review all ${total} uncommitted file(s)${fileHint ? ` (${fileHint})` : ""} for bugs or leftover debug code, then create a clean commit.`,
        `${total} uncommitted file(s)`,
      );
    }

    if (topic) {
      pushCandidate(
        "Implement the conclusion",
        `Based on the conclusion for "${topic}", go ahead and implement the concrete code changes and verify them.`,
      );
      pushCandidate(
        "List risks & remaining todos",
        `For "${topic}", list the top edge cases, risks, and remaining action items in a concise checklist.`,
      );
    } else {
      pushCandidate(
        "Implement the changes",
        "Go ahead and implement the changes concluded above, then verify everything works cleanly.",
      );
      pushCandidate(
        "Audit edge cases & trade-offs",
        "Walk through potential edge cases, failure modes, and trade-offs of the conclusion above.",
      );
    }
    pushCandidate(
      "Update docs & comments",
      `Update relevant docs or comments for ${fileHint || "these changes"} to reflect the latest behavior.`,
    );
  }

  // If user clicked "↻ 换一批", prioritize fresh prompts that weren't just shown
  const prevSet = new Set(previousPrompts.map((p) => p.trim()));
  const fresh = candidates.filter((c) => !prevSet.has(c.prompt.trim()));
  const recycled = candidates.filter((c) => prevSet.has(c.prompt.trim()));
  const ordered = [...fresh, ...recycled].slice(0, maxCount);

  return ordered.map((item, idx) => ({
    ...item,
    id: `h-${idx + 1}`,
  }));
}

function parseJsonFromLlm(raw: string): NextPromptItem[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: { suggestions?: Array<Record<string, unknown>> } | Array<Record<string, unknown>> | null = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Extract outermost JSON object or array if the model added surrounding prose
    const objStart = cleaned.indexOf("{");
    const objEnd = cleaned.lastIndexOf("}");
    const arrStart = cleaned.indexOf("[");
    const arrEnd = cleaned.lastIndexOf("]");
    const slices: string[] = [];
    if (objStart >= 0 && objEnd > objStart) slices.push(cleaned.slice(objStart, objEnd + 1));
    if (arrStart >= 0 && arrEnd > arrStart) slices.push(cleaned.slice(arrStart, arrEnd + 1));
    for (const s of slices) {
      try {
        parsed = JSON.parse(s);
        break;
      } catch {}
    }
  }

  if (!parsed) return [];
  const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
  const out: NextPromptItem[] = [];
  for (const item of arr) {
    const prompt = typeof item?.prompt === "string" ? item.prompt.trim() : "";
    if (!prompt) continue;
    const label =
      typeof item?.label === "string" && item.label.trim()
        ? item.label.trim().slice(0, 48)
        : prompt.slice(0, 40);
    const reason = typeof item?.reason === "string" && item.reason.trim() ? item.reason.trim().slice(0, 90) : undefined;
    out.push({
      id: `ai-${out.length + 1}`,
      label,
      prompt,
      reason,
    });
  }
  return out;
}

function buildSuggestionPrompts(
  cfg: StoredConfig,
  snap: TurnSnapshot,
  lang: "zh" | "en",
  previousPrompts: string[] = [],
): { systemPrompt: string; userPayload: string } {
  const langInstruction =
    lang === "zh"
      ? "Write all labels, prompts, and reasons in concise natural Simplified Chinese."
      : "Write all labels, prompts, and reasons in concise natural English.";

  const systemPrompt =
    "You predict the user's most useful next follow-up prompts after an AI coding agent finishes a turn. " +
    "Base every suggestion directly on the user's conversation context and the agent's FINAL conclusion. " +
    "If the agent's final reply already states an explicit '下一步' / 'Next steps' section or pending human action (e.g. approving an MR, releasing a pipeline, re-running a specific verification), prioritize actionable follow-up prompts directly aligned with that conclusion — do NOT resurrect intermediate errors that the agent already resolved or explained as expected. " +
    "Do NOT call any tools, do NOT read files, do NOT run shell commands. Respond immediately. " +
    `Return ONLY valid JSON: {"suggestions":[{"label":"short 3-8 word title","prompt":"self-contained actionable prompt to send directly to the coding agent","reason":"brief 1-line why"}]}. ` +
    `Provide exactly ${cfg.maxSuggestions} distinct, concrete, non-redundant suggestions. ${langInstruction}`;

  const userPayload = [
    snap.previousTurnsSummary ? `PRIOR CONVERSATION CONTEXT:\n${snap.previousTurnsSummary}` : "",
    snap.userText ? `LATEST USER REQUEST:\n${snap.userText}` : "",
    snap.assistantText ? `LATEST AGENT CONCLUSION / REPLY:\n${snap.assistantText}` : "",
    snap.pendingTodos.length > 0 ? `PENDING TODOS:\n- ${snap.pendingTodos.join("\n- ")}` : "",
    snap.editedFiles.length > 0 ? `EDITED FILES: ${snap.editedFiles.join(", ")}` : "",
    snap.unresolvedFailedCommand ? `UNRESOLVED FAILED COMMAND: ${snap.unresolvedFailedCommand}` : "",
    snap.toolNames.length > 0 ? `TOOLS USED: ${snap.toolNames.join(", ")}` : "",
    snap.turnFailed && snap.errorMessage ? `TURN ERROR: ${snap.errorMessage}` : "",
    snap.hasUncommittedChanges
      ? `GIT STATUS: modified=[${snap.gitModifiedFiles.join(", ")}], untracked=[${snap.gitUntrackedFiles.join(", ")}]`
      : "GIT STATUS: clean",
    previousPrompts.length > 0
      ? `AVOID REPEATING THESE PREVIOUS SUGGESTIONS (propose different angles/next steps):\n- ${previousPrompts.join("\n- ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { systemPrompt, userPayload };
}

async function callLlmSuggestions(
  cfg: StoredConfig,
  snap: TurnSnapshot,
  lang: "zh" | "en",
  previousPrompts: string[] = [],
): Promise<NextPromptItem[]> {
  const endpoint = buildChatCompletionsEndpoint(cfg.apiBaseUrl);
  const apiKey = resolveEffectiveApiKey(cfg);
  const local = isLocalEndpoint(cfg.apiBaseUrl);
  if (!apiKey && !local) {
    throw new Error("No API key configured for remote LLM endpoint");
  }

  const { systemPrompt, userPayload } = buildSuggestionPrompts(cfg, snap, lang, previousPrompts);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14000);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: cfg.model,
        temperature: previousPrompts.length > 0 ? 0.55 : 0.3,
        max_tokens: 600,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPayload },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from LLM");

    const parsed = parseJsonFromLlm(content).slice(0, cfg.maxSuggestions);
    if (parsed.length === 0) throw new Error("LLM returned no valid suggestions");
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

interface ProviderSnapshotEntryLite {
  provider: string;
  status?: string;
  enabled?: boolean;
  modes?: Array<{ id: string }>;
  models?: Array<{ id: string; isDefault?: boolean; isSelectable?: boolean }>;
}

function pickFastModelId(
  models: Array<{ id: string; isDefault?: boolean; isSelectable?: boolean }> | undefined,
  preferredModel?: string | null,
): string | null {
  if (!Array.isArray(models) || models.length === 0) return null;
  const selectable = models.filter((m) => m && typeof m.id === "string" && m.id.trim() && m.isSelectable !== false);
  const pool = selectable.length > 0 ? selectable : models.filter((m) => m && typeof m.id === "string" && m.id.trim());
  if (pool.length === 0) return null;

  // Prefer direct fast/lightweight models first (flash / luna / mini / haiku / fast / lite)
  const directFast = pool.find(
    (m) => !m.id.includes("/") && /(flash|luna|mini|haiku|fast|lite|spark)/i.test(m.id),
  );
  if (directFast) return directFast.id;

  const anyFast = pool.find((m) => /(flash|luna|mini|haiku|fast|lite|spark)/i.test(m.id));
  if (anyFast) return anyFast.id;

  const def = pool.find((m) => m.isDefault);
  if (def) return def.id;

  if (preferredModel) {
    const match = pool.find((m) => m.id === preferredModel);
    if (match) return match.id;
  }

  return pool[0].id;
}

async function resolveProviderModelString(
  paseo: PaseoServerApi,
  entry: ProviderSnapshotEntryLite,
  cwd?: string | null,
): Promise<{ provider: string; modeId?: string } | null> {
  let models = entry.models;
  if (!Array.isArray(models) || models.length === 0) {
    try {
      const res = await paseo.providers.listModels(entry.provider, cwd ? { cwd } : undefined);
      const fetched = (res as any)?.models;
      if (Array.isArray(fetched)) models = fetched;
    } catch {}
  }

  const modelId = pickFastModelId(models);
  if (!modelId) return null;

  const ask = entry.modes?.find((m) => /^(ask|plan)$/i.test(m.id));
  return {
    provider: `${entry.provider}/${modelId}`,
    modeId: ask?.id,
  };
}

async function resolvePaseoProvider(
  paseo: PaseoServerApi,
  configuredProvider: string,
  preferredProvider?: string | null,
  cwd?: string | null,
): Promise<{ provider: string; modeId?: string } | null> {
  const custom = configuredProvider.trim();
  // Already in "provider/model" format
  if (custom && custom !== "auto" && custom !== "same" && custom.includes("/")) {
    return { provider: custom };
  }

  let readyProviders: ProviderSnapshotEntryLite[] = [];
  try {
    const snap = await paseo.providers.snapshot(cwd ? { cwd } : undefined);
    const rawList = (snap as any)?.entries ?? (snap as any)?.providers;
    const list = Array.isArray(rawList) ? (rawList as ProviderSnapshotEntryLite[]) : [];
    readyProviders = list.filter(
      (p) => p.enabled !== false && (p.status === "ready" || p.status === "available" || !p.status),
    );
  } catch (err) {
    console.warn("[paseo-next-prompts] providers.snapshot failed:", err instanceof Error ? err.message : String(err));
    return null;
  }

  const findReady = (id: string) => readyProviders.find((p) => p.provider === id);

  // User pinned a specific provider ID (without /model)
  if (custom && custom !== "auto" && custom !== "same") {
    const pinned = findReady(custom) ?? { provider: custom };
    return resolveProviderModelString(paseo, pinned, cwd);
  }

  const candidateOrder: ProviderSnapshotEntryLite[] = [];
  if (preferredProvider) {
    const hit = findReady(preferredProvider);
    if (hit) candidateOrder.push(hit);
  }

  const preferenceOrder = ["codex", "cursor", "claude", "opencode", "copilot"];
  for (const id of preferenceOrder) {
    const hit = findReady(id);
    if (hit && !candidateOrder.some((c) => c.provider === hit.provider)) {
      candidateOrder.push(hit);
    }
  }
  for (const entry of readyProviders) {
    if (!candidateOrder.some((c) => c.provider === entry.provider)) {
      candidateOrder.push(entry);
    }
  }

  for (const candidate of candidateOrder) {
    const resolved = await resolveProviderModelString(paseo, candidate, cwd);
    if (resolved) return resolved;
  }

  return null;
}

async function runPaseoHelperPrompt(params: {
  paseo: PaseoServerApi;
  provider: string;
  modeId?: string;
  cwd?: string | null;
  workspaceId?: string | null;
  systemPrompt: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<string> {
  const baseCreateOptions = {
    background: true,
    autoArchive: true,
    title: "Next Prompts Helper",
    metadata: { [HELPER_METADATA_KEY]: true },
    config: {
      provider: params.provider,
      ...(params.modeId ? { modeId: params.modeId } : {}),
      systemPrompt: params.systemPrompt,
    },
    prompt: params.prompt,
  };

  let createdStandaloneWorkspace = false;
  let helper;
  if (params.workspaceId) {
    try {
      helper = await params.paseo.workspaces.ref(params.workspaceId).agents.create(baseCreateOptions);
    } catch {
      createdStandaloneWorkspace = true;
      helper = await params.paseo.agents.create({
        ...baseCreateOptions,
        cwd: params.cwd || os.homedir(),
      });
    }
  } else {
    createdStandaloneWorkspace = true;
    helper = await params.paseo.agents.create({
      ...baseCreateOptions,
      cwd: params.cwd || os.homedir(),
    });
  }

  try {
    const result = await helper.waitForFinish(params.timeoutMs ?? 28000);
    if (result.status !== "idle") {
      throw new Error(result.error || `Paseo helper ended with status: ${result.status}`);
    }
    const text = result.lastMessage?.trim();
    if (!text) throw new Error("Paseo helper returned empty message");
    return text;
  } finally {
    await helper.archive().catch(() => {});
    if (createdStandaloneWorkspace) {
      const helperWorkspaceId =
        helper.workspaceId ??
        helper.current()?.workspaceId ??
        (await helper.refresh().catch(() => null))?.agent.workspaceId ??
        null;
      if (helperWorkspaceId && helperWorkspaceId !== params.workspaceId) {
        await params.paseo.workspaces.archive(helperWorkspaceId).catch(() => {});
      }
    }
  }
}

async function callPaseoAgentSuggestions(
  paseo: PaseoServerApi,
  cfg: StoredConfig,
  snap: TurnSnapshot,
  lang: "zh" | "en",
  previousPrompts: string[] = [],
): Promise<{ suggestions: NextPromptItem[]; provider: string }> {
  const resolved = await resolvePaseoProvider(
    paseo,
    cfg.paseoProvider,
    snap.resolvedProvider,
    snap.resolvedCwd,
  );
  if (!resolved) {
    throw new Error("No ready Paseo provider available");
  }

  const { systemPrompt, userPayload } = buildSuggestionPrompts(cfg, snap, lang, previousPrompts);
  const fullPrompt =
    "Based ONLY on the context below (do NOT run any tools, shell commands, or file reads), output ONLY the JSON object of next prompt suggestions:\n\n" +
    userPayload;

  const content = await runPaseoHelperPrompt({
    paseo,
    provider: resolved.provider,
    modeId: resolved.modeId,
    cwd: snap.resolvedCwd,
    workspaceId: snap.resolvedWorkspaceId,
    systemPrompt,
    prompt: fullPrompt,
    timeoutMs: 28000,
  });

  const parsed = parseJsonFromLlm(content).slice(0, cfg.maxSuggestions);
  if (parsed.length === 0) throw new Error("Paseo provider returned no valid suggestions JSON");
  return { suggestions: parsed, provider: resolved.provider };
}

export async function testLlmConnection() {
  const cfg = loadConfig();
  const start = Date.now();
  try {
    const sampleSnap: TurnSnapshot = {
      previousTurnsSummary: "",
      userText: "Add input validation to the login handler.",
      assistantText: "Updated auth/login.ts to validate email and password fields and return 400 on invalid payloads.",
      pendingTodos: [],
      editedFiles: ["auth/login.ts"],
      readFiles: [],
      failedCommands: [],
      unresolvedFailedCommand: null,
      toolNames: ["edit_file"],
      turnFailed: false,
      hadError: false,
      errorMessage: "",
      gitModifiedFiles: ["auth/login.ts"],
      gitUntrackedFiles: [],
      hasUncommittedChanges: true,
      resolvedCwd: null,
      resolvedProvider: null,
      resolvedWorkspaceId: null,
    };
    const lang = cfg.language === "zh" ? "zh" : "en";
    const suggestions = await callLlmSuggestions(cfg, sampleSnap, lang);
    return {
      ok: true,
      latencyMs: Date.now() - start,
      model: cfg.model,
      sampleCount: suggestions.length,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      model: cfg.model,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function isAgentIdleAndReady(paseo: PaseoServerApi, agentId: string): Promise<boolean> {
  try {
    const refreshed = await paseo.agents.ref(agentId).refresh();
    const agent = refreshed?.agent;
    if (!agent) return false;
    if (agent.status !== "idle") return false;
    if (agent.activeTurn != null) return false;
    if (Array.isArray(agent.pendingPermissions) && agent.pendingPermissions.length > 0) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function publishSuggestions(params: {
  paseo: PaseoServerApi;
  agentId: string;
  cfg: StoredConfig;
  resolvedTurnId: string;
  engine: NextPromptsEngine;
  model?: string;
  suggestions: NextPromptItem[];
  composerOnly?: boolean;
  force?: boolean;
}): Promise<void> {
  if (!params.force && !(await isAgentIdleAndReady(params.paseo, params.agentId))) {
    return;
  }
  const payload: NextPromptsTimelineData = {
    turnId: params.resolvedTurnId,
    engine: params.engine,
    model: params.model,
    generatedAt: new Date().toISOString(),
    suggestions: params.suggestions,
  };

  const agentRef = params.paseo.agents.ref(params.agentId);
  if (params.cfg.displayMode === "composer" || params.cfg.displayMode === "both") {
    try {
      await agentRef.setMetadata({
        [COMPOSER_METADATA_KEY]: {
          agentId: params.agentId,
          ...payload,
        },
      });
    } catch {
      if (!params.composerOnly) {
        await agentRef.timeline.append({
          type: "plugin",
          id: `next-prompts-${params.resolvedTurnId}`,
          kind: "next-prompts",
          version: 1,
          data: payload,
        });
      }
    }
  }

  if (!params.composerOnly && (params.cfg.displayMode === "timeline" || params.cfg.displayMode === "both")) {
    await agentRef.timeline.append({
      type: "plugin",
      id: `next-prompts-${params.resolvedTurnId}`,
      kind: "next-prompts",
      version: 1,
      data: payload,
    });
  }
}

export async function generateAndAppendNextPrompts(params: {
  paseo: PaseoServerApi;
  agentId: string;
  turnId?: string | null;
  cwd?: string | null;
  provider?: string | null;
  workspaceId?: string | null;
  previousPrompts?: string[];
  turnFailed?: boolean;
  force?: boolean;
}): Promise<{ ok: boolean; engine: NextPromptsEngine; model?: string; count: number; error?: string }> {
  const cfg = loadConfig();
  if (!cfg.enabled && !params.force) {
    return { ok: false, engine: "heuristic", count: 0 };
  }

  if (!params.force && !(await isAgentIdleAndReady(params.paseo, params.agentId))) {
    return { ok: false, engine: "heuristic", count: 0 };
  }

  const mySeq = bumpAgentGeneration(params.agentId);

  const snap = await extractTurnSnapshot(
    params.paseo,
    params.agentId,
    params.turnId,
    params.cwd,
    params.provider,
    Boolean(params.turnFailed),
    params.workspaceId,
  );
  if (!snap) {
    return { ok: false, engine: "heuristic", count: 0, error: "No recent turn found to analyze." };
  }
  if (!params.force && !params.turnFailed && !snap.assistantText.trim()) {
    return { ok: false, engine: "heuristic", count: 0 };
  }

  const lang = detectLanguage(cfg.language, snap.userText, snap.assistantText);
  const previousPrompts = params.previousPrompts ?? [];
  const resolvedTurnId = params.turnId || `manual-${Date.now()}`;

  // 1. Heuristic-only mode
  if (cfg.mode === "heuristic") {
    const suggestions = buildHeuristicSuggestions(snap, lang, cfg.maxSuggestions, previousPrompts);
    if (suggestions.length === 0) return { ok: false, engine: "heuristic", count: 0 };
    if (generationSeqByAgent.get(params.agentId) !== mySeq) {
      return { ok: false, engine: "heuristic", count: 0 };
    }
    await publishSuggestions({
      paseo: params.paseo,
      agentId: params.agentId,
      cfg,
      resolvedTurnId,
      engine: "heuristic",
      suggestions,
    });
    return { ok: true, engine: "heuristic", count: suggestions.length };
  }

  // 2. Direct OpenAI-compatible / Ollama LLM (fast, 1-2s)
  if (cfg.mode === "llm" || (cfg.mode === "auto" && canUseDirectLlm(cfg))) {
    try {
      const suggestions = await callLlmSuggestions(cfg, snap, lang, previousPrompts);
      if (generationSeqByAgent.get(params.agentId) !== mySeq) {
        return { ok: false, engine: "llm", model: cfg.model, count: 0 };
      }
      await publishSuggestions({
        paseo: params.paseo,
        agentId: params.agentId,
        cfg,
        resolvedTurnId,
        engine: "llm",
        model: cfg.model,
        suggestions,
      });
      return { ok: true, engine: "llm", model: cfg.model, count: suggestions.length };
    } catch (error) {
      if (cfg.mode === "llm") {
        return {
          ok: false,
          engine: "llm",
          model: cfg.model,
          count: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      // In auto mode, continue to Paseo built-in provider below
    }
  }

  // 3. Paseo Built-in Provider (zero extra API key needed!)
  // For automatic turn-end in composer mode, publish context-aware heuristic immediately (0ms),
  // then seamlessly upgrade metadata when the Paseo background agent finishes.
  const heuristicSuggestions = buildHeuristicSuggestions(snap, lang, cfg.maxSuggestions, previousPrompts);
  const shouldPublishProgressive =
    !params.force &&
    (cfg.mode === "paseo" || cfg.mode === "auto") &&
    cfg.displayMode === "composer" &&
    heuristicSuggestions.length > 0;

  if (shouldPublishProgressive && generationSeqByAgent.get(params.agentId) === mySeq) {
    await publishSuggestions({
      paseo: params.paseo,
      agentId: params.agentId,
      cfg,
      resolvedTurnId,
      engine: "heuristic",
      suggestions: heuristicSuggestions,
      composerOnly: true,
    });
  }

  try {
    const { suggestions, provider } = await callPaseoAgentSuggestions(
      params.paseo,
      cfg,
      snap,
      lang,
      previousPrompts,
    );
    if (generationSeqByAgent.get(params.agentId) !== mySeq) {
      return { ok: false, engine: "paseo", model: provider, count: 0 };
    }
    await publishSuggestions({
      paseo: params.paseo,
      agentId: params.agentId,
      cfg,
      resolvedTurnId,
      engine: "paseo",
      model: provider,
      suggestions,
    });
    return { ok: true, engine: "paseo", model: provider, count: suggestions.length };
  } catch (error) {
    console.warn(
      "[paseo-next-prompts] Paseo provider suggestion failed:",
      error instanceof Error ? error.message : String(error),
    );
    if (cfg.mode === "paseo") {
      return {
        ok: false,
        engine: "paseo",
        count: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // Auto mode fallback: if we haven't already published heuristic, publish it now
    if (!shouldPublishProgressive && heuristicSuggestions.length > 0 && generationSeqByAgent.get(params.agentId) === mySeq) {
      await publishSuggestions({
        paseo: params.paseo,
        agentId: params.agentId,
        cfg,
        resolvedTurnId,
        engine: "heuristic",
        suggestions: heuristicSuggestions,
      });
    }
    return {
      ok: heuristicSuggestions.length > 0,
      engine: "heuristic",
      count: heuristicSuggestions.length,
    };
  }
}

export async function clearComposerSuggestions(paseo: PaseoServerApi, agentId: string): Promise<void> {
  invalidateAgentGeneration(agentId);
  try {
    await paseo.agents.ref(agentId).setMetadata({ [COMPOSER_METADATA_KEY]: null });
  } catch {}
}

function buildHeuristicOptimizedPrompt(
  draft: string,
  lang: "zh" | "en",
  changedFiles: string[],
): string {
  const clean = draft.trim();
  const fileList = changedFiles.slice(0, 5).join(", ");
  const hasTestHint = /\b(test|typecheck|verify|build)\b/i.test(clean) || /测试|验证|编译|检查/.test(clean);

  if (lang === "zh") {
    const lines = [
      `目标：${clean}`,
      "",
      "执行要求：",
      "1. 先定位相关代码与上下文，确认改动范围和边界条件后再动手修改。",
      ...(fileList ? [`2. 重点关注当前工作区已有改动的相关文件：${fileList}。`] : []),
      `${fileList ? "3" : "2"}. 保持代码风格与现有架构一致，避免引入无关改动。`,
      ...(!hasTestHint
        ? [`${fileList ? "4" : "3"}. 改动完成后运行必要的类型检查或单元测试验证结果，并简明汇报修改点。`]
        : []),
    ];
    return lines.join("\n");
  }

  const lines = [
    `Goal: ${clean}`,
    "",
    "Requirements:",
    "1. Inspect the relevant files and existing patterns first to confirm scope and edge cases before editing.",
    ...(fileList ? [`2. Account for current workspace changes in: ${fileList}.`] : []),
    `${fileList ? "3" : "2"}. Keep changes minimal, clean, and consistent with the surrounding codebase.`,
    ...(!hasTestHint
      ? [`${fileList ? "4" : "3"}. Run relevant typechecks or tests to verify the fix, then summarize what changed.`]
      : []),
  ];
  return lines.join("\n");
}

function buildOptimizePrompts(
  draft: string,
  lang: "zh" | "en",
  contextSummary: string,
): { systemPrompt: string; userPayload: string } {
  const langInstruction =
    lang === "zh"
      ? "Output the optimized prompt in clear, natural Simplified Chinese."
      : "Output the optimized prompt in clear, natural English.";

  const systemPrompt =
    "You are an expert prompt engineer for AI coding agents (like Codex and Claude Code). " +
    "Rewrite the user's rough draft into a crisp, specific, self-contained, actionable coding prompt. " +
    "Preserve the user's exact intent, incorporate concrete details from the recent conversation context where relevant, add clear structure only where helpful, and keep it concise without fluff. " +
    "Do NOT call any tools or read any files. " +
    `Return ONLY the rewritten prompt text with no preamble, no quotes, and no markdown wrapper. ${langInstruction}`;

  const userPayload = [
    `USER DRAFT:\n${draft}`,
    contextSummary ? `WORKSPACE & RECENT CONTEXT:\n${contextSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { systemPrompt, userPayload };
}

async function callLlmOptimizePrompt(
  cfg: StoredConfig,
  draft: string,
  lang: "zh" | "en",
  contextSummary: string,
): Promise<string> {
  const endpoint = buildChatCompletionsEndpoint(cfg.apiBaseUrl);
  const apiKey = resolveEffectiveApiKey(cfg);
  const local = isLocalEndpoint(cfg.apiBaseUrl);
  if (!apiKey && !local) {
    throw new Error("No API key configured for remote LLM endpoint");
  }

  const { systemPrompt, userPayload } = buildOptimizePrompts(draft, lang, contextSummary);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14000);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        max_tokens: 600,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPayload },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("Empty response from LLM");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

export async function optimizeUserPrompt(params: {
  paseo: PaseoServerApi;
  agentId: string;
  draft: string;
  cwd?: string | null;
  provider?: string | null;
}): Promise<{ ok: boolean; optimized: string; engine: NextPromptsEngine; model?: string; error?: string }> {
  const cfg = loadConfig();
  const draft = params.draft.trim();
  const lang = detectLanguage(cfg.language, draft, "");

  let resolvedCwd = params.cwd || null;
  let resolvedProvider = params.provider || null;
  let resolvedWorkspaceId: string | null = null;
  let recentAssistant = "";
  try {
    const snap = await extractTurnSnapshot(params.paseo, params.agentId, null, resolvedCwd, resolvedProvider);
    if (snap) {
      recentAssistant = snap.assistantText.slice(-1200);
      resolvedCwd = snap.resolvedCwd || resolvedCwd;
      resolvedProvider = snap.resolvedProvider || resolvedProvider;
      resolvedWorkspaceId = snap.resolvedWorkspaceId || resolvedWorkspaceId;
    }
  } catch {}
  if (!resolvedWorkspaceId) {
    const refreshed = await params.paseo.agents.ref(params.agentId).refresh().catch(() => null);
    if (refreshed?.agent?.workspaceId) {
      resolvedWorkspaceId = refreshed.agent.workspaceId;
    }
  }

  const git = await readGitContext(resolvedCwd);
  const changedFiles = [...git.modified, ...git.untracked];

  const ctxParts = [
    changedFiles.length > 0 ? `Modified/untracked files: ${changedFiles.join(", ")}` : "",
    recentAssistant ? `Last assistant reply excerpt:\n${recentAssistant}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (cfg.mode === "llm" || (cfg.mode === "auto" && canUseDirectLlm(cfg))) {
    try {
      const optimized = await callLlmOptimizePrompt(cfg, draft, lang, ctxParts);
      return { ok: true, optimized, engine: "llm", model: cfg.model };
    } catch (error) {
      if (cfg.mode === "llm") {
        return {
          ok: false,
          optimized: draft,
          engine: "llm",
          model: cfg.model,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  if (cfg.mode === "paseo" || cfg.mode === "auto") {
    try {
      const resolved = await resolvePaseoProvider(
        params.paseo,
        cfg.paseoProvider,
        resolvedProvider,
        resolvedCwd,
      );
      if (resolved) {
        const { systemPrompt, userPayload } = buildOptimizePrompts(draft, lang, ctxParts);
        const optimized = await runPaseoHelperPrompt({
          paseo: params.paseo,
          provider: resolved.provider,
          modeId: resolved.modeId,
          cwd: resolvedCwd,
          workspaceId: resolvedWorkspaceId,
          systemPrompt,
          prompt: `Rewrite this rough prompt (do NOT call any tools):\n\n${userPayload}`,
          timeoutMs: 28000,
        });
        return { ok: true, optimized, engine: "paseo", model: resolved.provider };
      }
    } catch (error) {
      if (cfg.mode === "paseo") {
        return {
          ok: false,
          optimized: draft,
          engine: "paseo",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  return {
    ok: true,
    optimized: buildHeuristicOptimizedPrompt(draft, lang, changedFiles),
    engine: "heuristic",
  };
}

export function shouldSkipBackground(): boolean {
  return loadConfig().skipBackgroundAgents;
}
