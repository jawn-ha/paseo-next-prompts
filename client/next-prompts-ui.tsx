import type {
  PluginButtonContentProps,
  PluginSurfaceProps,
  PluginTimelineItemProps,
} from "@getpaseo/plugin/client";
import { useAgent, useComposers, useRpc } from "@getpaseo/plugin/client";
import { TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  type NextPromptsDisplayMode,
  type NextPromptsLanguage,
  type NextPromptsMode,
  type NextPromptsTimelineData,
  NextPromptsTimelineSchema,
  generateNextPromptsRpc,
  getNextPromptsConfigRpc,
  optimizePromptRpc,
  saveNextPromptsConfigRpc,
  sendNextPromptRpc,
  testNextPromptsLlmRpc,
} from "../shared/contracts";

const COMPOSER_METADATA_KEY = "paseo-next-prompts";

const LLM_PRESETS = [
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  { label: "Ollama (Local)", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b" },
];

export function NextPromptsComposerPopover(props: PluginButtonContentProps) {
  if (props.context !== "agent") return null;
  return (
    <NextPromptsPopoverBody
      agentId={props.agentId}
      theme={props.theme}
      close={props.close}
    />
  );
}

function NextPromptsPopoverBody({
  agentId,
  theme,
  close,
}: {
  agentId: string;
  theme: PluginButtonContentProps["theme"];
  close(): void;
}) {
  const toast = useToast();
  const sendPrompt = useRpc(sendNextPromptRpc);
  const regenerate = useRpc(generateNextPromptsRpc);
  const optimizePrompt = useRpc(optimizePromptRpc);
  const composers = useComposers({ agentId });

  const [previousDraft, setPreviousDraft] = useState<string | null>(null);

  const agentData = useAgent(agentId, (a) => ({
    cwd: a.cwd,
    provider: a.provider,
    meta: (a.metadata as Record<string, unknown> | undefined)?.[COMPOSER_METADATA_KEY],
  }));
  const rawMeta = agentData?.meta;
  const parsed = rawMeta && typeof rawMeta === "object"
    ? NextPromptsTimelineSchema.safeParse(rawMeta)
    : null;
  const suggestions = parsed?.success ? parsed.data.suggestions : [];

  const currentDraft = composers[0]?.prompt?.trim() ?? "";

  const optimizeMutation = useMutation({
    mutationFn: async () => {
      const composer = composers[0];
      const draft = composer?.prompt?.trim() ?? "";
      if (!draft) {
        throw new Error("请先在聊天输入框里输入一点内容再优化");
      }
      setPreviousDraft(draft);
      const res = await optimizePrompt({
        agentId,
        draft,
        cwd: agentData?.cwd ?? undefined,
        provider: agentData?.provider ?? undefined,
      });
      if (!res.ok) {
        throw new Error(res.error || "Prompt optimization failed");
      }
      composer.setPrompt(res.optimized);
      try {
        await composer.focus();
      } catch {}
      return res;
    },
    onSuccess(res) {
      toast.show(
        res.engine !== "heuristic" ? `已用 ${res.model ?? "AI"} 优化提示词` : "已优化提示词（本地模式）",
        { variant: "success" },
      );
      close();
    },
    onError(err) {
      toast.error(err instanceof Error ? err.message : String(err));
    },
  });

  const handleUndoOptimize = async () => {
    const composer = composers[0];
    if (composer && previousDraft !== null) {
      composer.setPrompt(previousDraft);
      setPreviousDraft(null);
      try {
        await composer.focus();
      } catch {}
    }
  };

  const sendMutation = useMutation({
    mutationFn: (prompt: string) => sendPrompt({ agentId, prompt }),
    onSuccess() {
      close();
    },
    onError(err) {
      toast.error(err instanceof Error ? err.message : String(err));
    },
  });

  const regenMutation = useMutation({
    mutationFn: () =>
      regenerate({
        agentId,
        cwd: agentData?.cwd ?? undefined,
        provider: agentData?.provider ?? undefined,
        previousPrompts: suggestions.map((s) => s.prompt),
      }),
    onSuccess(res) {
      if (!res.ok && res.error) toast.error(res.error);
    },
    onError(err) {
      toast.error(err instanceof Error ? err.message : String(err));
    },
  });

  const handleFill = async (prompt: string) => {
    const composer = composers[0];
    if (composer) {
      composer.setPrompt(prompt);
      try {
        await composer.focus({ selection: { start: 0, end: prompt.length } });
      } catch {}
    }
    close();
  };

  const handleClear = () => {
    const composer = composers[0];
    if (composer) {
      composer.setPrompt("");
    }
    close();
  };

  const engineLabel = parsed?.success
    ? parsed.data.engine === "llm"
      ? `AI · ${parsed.data.model ?? "LLM"}`
      : parsed.data.engine === "paseo"
        ? `AI · ${parsed.data.model ?? "Paseo"}`
        : "Local · Context"
    : "";

  return (
    <View
      style={{
        width: 340,
        padding: 12,
        gap: 8,
        backgroundColor: theme.colors.surface0,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ color: theme.colors.foreground, fontWeight: "700", fontSize: 13 }}>
            ✨ Next Prompts
          </Text>
          {engineLabel ? (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10.5 }}>
              {engineLabel}
            </Text>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Pressable
            accessibilityRole="button"
            disabled={regenMutation.isPending}
            onPress={() => regenMutation.mutate()}
            style={{
              paddingHorizontal: 7,
              paddingVertical: 3,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface1,
              opacity: regenMutation.isPending ? 0.5 : 1,
            }}
          >
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
              {regenMutation.isPending ? "..." : "↻ 换一批"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={handleClear}
            style={{
              paddingHorizontal: 7,
              paddingVertical: 3,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface1,
            }}
          >
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>清空</Text>
          </Pressable>
        </View>
      </View>

      {/* One-Click Optimize Current Draft */}
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Pressable
          accessibilityRole="button"
          disabled={!currentDraft || optimizeMutation.isPending}
          onPress={() => optimizeMutation.mutate()}
          style={{
            flex: 1,
            paddingHorizontal: 10,
            paddingVertical: 8,
            borderRadius: 8,
            backgroundColor: currentDraft ? theme.colors.accent : theme.colors.surface1,
            borderWidth: currentDraft ? 0 : 1,
            borderColor: theme.colors.border,
            alignItems: "center",
            opacity: !currentDraft || optimizeMutation.isPending ? 0.55 : 1,
          }}
        >
          <Text
            style={{
              color: currentDraft ? theme.colors.accentForeground : theme.colors.foregroundMuted,
              fontWeight: "700",
              fontSize: 12,
            }}
          >
            {optimizeMutation.isPending
              ? "✨ 优化中..."
              : currentDraft
                ? "✨ 一键优化当前输入"
                : "✨ 输入内容后可一键优化 Prompt"}
          </Text>
        </Pressable>

        {previousDraft !== null ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void handleUndoOptimize()}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface1,
              justifyContent: "center",
            }}
          >
            <Text style={{ color: theme.colors.foreground, fontSize: 11.5, fontWeight: "600" }}>
              ↩ 撤销
            </Text>
          </Pressable>
        ) : null}
      </View>

      {suggestions.length === 0 ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          No suggestions yet. Run a turn or click ↻ to generate.
        </Text>
      ) : (
        <View style={{ gap: 6 }}>
          {suggestions.map((s) => (
            <View
              key={s.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                borderRadius: 9,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface1,
                overflow: "hidden",
              }}
            >
              <Pressable
                accessibilityRole="button"
                onPress={() => void handleFill(s.prompt)}
                style={{ flex: 1, paddingHorizontal: 10, paddingVertical: 8, gap: 2 }}
              >
                <Text style={{ color: theme.colors.foreground, fontSize: 12.5, fontWeight: "600" }}>
                  {s.label}
                </Text>
                <Text
                  style={{ color: theme.colors.foregroundMuted, fontSize: 11.5 }}
                  numberOfLines={2}
                >
                  {s.prompt}
                </Text>
                {s.reason ? (
                  <Text
                    style={{ color: theme.colors.foregroundMuted, fontSize: 10.5, opacity: 0.78 }}
                    numberOfLines={1}
                  >
                    {s.reason}
                  </Text>
                ) : null}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                disabled={sendMutation.isPending}
                onPress={() => sendMutation.mutate(s.prompt)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 10,
                  alignSelf: "stretch",
                  justifyContent: "center",
                  borderLeftWidth: 1,
                  borderLeftColor: theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                  opacity: sendMutation.isPending ? 0.5 : 1,
                }}
              >
                <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "700" }}>
                  ↵
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export function NextPromptsTimelineRenderer({
  agentId,
  item,
  theme,
}: PluginTimelineItemProps<NextPromptsTimelineData>) {
  const toast = useToast();
  const sendPrompt = useRpc(sendNextPromptRpc);
  const regenerate = useRpc(generateNextPromptsRpc);
  const composers = useComposers({ agentId });
  const agentInfo = useAgent(agentId, (a) => ({ cwd: a.cwd, provider: a.provider }));

  const [sentId, setSentId] = useState<string | null>(null);

  const sendMutation = useMutation({
    mutationFn: async (vars: { id: string; prompt: string }) => {
      await sendPrompt({ agentId, prompt: vars.prompt });
      return vars.id;
    },
    onSuccess(id) {
      setSentId(id);
    },
    onError(err) {
      toast.error(err instanceof Error ? err.message : String(err));
    },
  });

  const regenMutation = useMutation({
    mutationFn: () =>
      regenerate({
        agentId,
        cwd: agentInfo?.cwd ?? undefined,
        provider: agentInfo?.provider ?? undefined,
        previousPrompts: item.data.suggestions.map((s) => s.prompt),
      }),
    onSuccess(res) {
      if (!res.ok && res.error) toast.error(res.error);
    },
    onError(err) {
      toast.error(err instanceof Error ? err.message : String(err));
    },
  });

  const handleEditInComposer = async (prompt: string) => {
    const composer = composers[0];
    if (!composer) {
      toast.error("Composer is not available for this agent.");
      return;
    }
    composer.setPrompt(prompt);
    try {
      await composer.focus();
    } catch {}
  };

  const { data } = item;
  const badgeText =
    data.engine === "llm"
      ? `AI · ${data.model ?? "LLM"}`
      : data.engine === "paseo"
        ? `AI · ${data.model ?? "Paseo"}`
        : "Local · Context";

  return (
    <View
      style={{
        padding: 12,
        borderRadius: 12,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: 8,
      }}
    >
      {/* Header row */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: theme.colors.foreground, fontWeight: "700", fontSize: 12 }}>
            ✨ Next Prompts
          </Text>
          <View
            style={{
              paddingHorizontal: 7,
              paddingVertical: 2,
              borderRadius: 6,
              backgroundColor: theme.colors.surface2,
            }}
          >
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, fontWeight: "600" }}>
              {badgeText}
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={regenMutation.isPending}
          onPress={() => regenMutation.mutate()}
          style={{
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 6,
            backgroundColor: theme.colors.surface0,
            borderWidth: 1,
            borderColor: theme.colors.border,
            opacity: regenMutation.isPending ? 0.5 : 1,
          }}
        >
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
            {regenMutation.isPending ? "..." : "↻"}
          </Text>
        </Pressable>
      </View>

      {/* Suggestion rows */}
      <View style={{ gap: 6 }}>
        {data.suggestions.map((s) => {
          const isSent = sentId === s.id;
          const isBusy = sendMutation.isPending;
          return (
            <View
              key={s.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                borderRadius: 9,
                borderWidth: 1,
                borderColor: isSent ? theme.colors.accent : theme.colors.border,
                backgroundColor: theme.colors.surface0,
                overflow: "hidden",
              }}
            >
              <Pressable
                accessibilityRole="button"
                disabled={isBusy}
                onPress={() => sendMutation.mutate({ id: s.id, prompt: s.prompt })}
                style={{
                  flex: 1,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  gap: 2,
                  opacity: isBusy ? 0.6 : 1,
                }}
              >
                <Text style={{ color: theme.colors.foreground, fontSize: 12.5, fontWeight: "600" }}>
                  {isSent ? "✓ " : "→ "}
                  {s.label}
                </Text>
                <Text
                  style={{ color: theme.colors.foregroundMuted, fontSize: 11.5 }}
                  numberOfLines={2}
                >
                  {s.prompt}
                </Text>
                {s.reason ? (
                  <Text
                    style={{ color: theme.colors.foregroundMuted, fontSize: 10.5, opacity: 0.8 }}
                    numberOfLines={1}
                  >
                    {s.reason}
                  </Text>
                ) : null}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={() => void handleEditInComposer(s.prompt)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 10,
                  alignSelf: "stretch",
                  justifyContent: "center",
                  borderLeftWidth: 1,
                  borderLeftColor: theme.colors.border,
                  backgroundColor: theme.colors.surface1,
                }}
              >
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>✎</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function NextPromptsSettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const getConfig = useRpc(getNextPromptsConfigRpc);
  const saveConfig = useRpc(saveNextPromptsConfigRpc);
  const testLlm = useRpc(testNextPromptsLlmRpc);

  const configQuery = useQuery({
    queryKey: ["paseo-next-prompts", "config"],
    queryFn: () => getConfig({}),
  });

  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<NextPromptsMode>("auto");
  const [displayMode, setDisplayMode] = useState<NextPromptsDisplayMode>("composer");
  const [maxSuggestions, setMaxSuggestions] = useState(3);
  const [language, setLanguage] = useState<NextPromptsLanguage>("auto");
  const [paseoProvider, setPaseoProvider] = useState("auto");
  const [apiBaseUrl, setApiBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("gpt-4o-mini");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [skipBackgroundAgents, setSkipBackgroundAgents] = useState(true);

  useEffect(() => {
    const d = configQuery.data;
    if (!d) return;
    setEnabled(d.enabled);
    setMode(d.mode);
    setDisplayMode(d.displayMode);
    setMaxSuggestions(d.maxSuggestions);
    setLanguage(d.language);
    setPaseoProvider(d.paseoProvider);
    setApiBaseUrl(d.apiBaseUrl);
    setModel(d.model);
    setSkipBackgroundAgents(d.skipBackgroundAgents);
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (clearApiKey: boolean) =>
      saveConfig({
        enabled,
        mode,
        displayMode,
        maxSuggestions,
        language,
        paseoProvider,
        apiBaseUrl,
        model,
        apiKey: apiKeyInput.trim() || undefined,
        clearApiKey,
        skipBackgroundAgents,
      }),
    onSuccess() {
      setApiKeyInput("");
      void queryClient.invalidateQueries({ queryKey: ["paseo-next-prompts"] });
      toast.show("Saved Next Prompts settings", { variant: "success" });
    },
    onError(err) {
      toast.error(err instanceof Error ? err.message : String(err));
    },
  });

  const testMutation = useMutation({
    mutationFn: () => testLlm({}),
    onSuccess(res) {
      if (res.ok) {
        toast.show(
          `LLM OK (${res.model}) — generated ${res.sampleCount} suggestions in ${res.latencyMs}ms`,
          { variant: "success" },
        );
      } else {
        toast.error(`LLM Test Failed: ${res.error}`);
      }
    },
    onError(err) {
      toast.error(err instanceof Error ? err.message : String(err));
    },
  });

  const pad = layout.compact ? 14 : 24;
  const chipStyle = (active: boolean) => ({
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: active ? theme.colors.accent : theme.colors.border,
    backgroundColor: active ? theme.colors.surface2 : theme.colors.surface0,
  });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: pad, gap: 16 }}
    >
      <View style={{ gap: 4 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: layout.compact ? 20 : 24, fontWeight: "700" }}>
          ✨ Next Prompts
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
          Automatically suggests clickable follow-up prompts after every agent turn. Supports fast OpenAI-compatible LLMs and an instant zero-config local heuristic engine.
        </Text>
      </View>

      {/* General toggles */}
      <View
        style={{
          padding: 14,
          borderRadius: 12,
          backgroundColor: theme.colors.surface1,
          borderWidth: 1,
          borderColor: theme.colors.border,
          gap: 12,
        }}
      >
        <Text style={{ color: theme.colors.foreground, fontWeight: "600", fontSize: 14 }}>
          General Behavior
        </Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Pressable accessibilityRole="button" onPress={() => setEnabled((v) => !v)} style={chipStyle(enabled)}>
            <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>
              {enabled ? "✓ Auto-suggest after turn: ON" : "Auto-suggest after turn: OFF"}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => setSkipBackgroundAgents((v) => !v)}
            style={chipStyle(skipBackgroundAgents)}
          >
            <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>
              {skipBackgroundAgents ? "✓ Skip background subagents" : "Include background subagents"}
            </Text>
          </Pressable>
        </View>

        <View style={{ gap: 6 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" }}>
            Display Position
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {(
              [
                { id: "composer", label: "Chat Box (Codex-style)" },
                { id: "timeline", label: "Timeline Card" },
                { id: "both", label: "Both" },
              ] as const
            ).map((opt) => (
              <Pressable
                key={opt.id}
                accessibilityRole="button"
                onPress={() => setDisplayMode(opt.id)}
                style={chipStyle(displayMode === opt.id)}
              >
                <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: displayMode === opt.id ? "600" : "400" }}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={{ gap: 6 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" }}>
            Generation Engine
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {(
              [
                { id: "auto", label: "Auto (LLM → Paseo AI → Local)" },
                { id: "paseo", label: "Paseo Provider (Zero-Key AI)" },
                { id: "llm", label: "Custom Fast LLM Only" },
                { id: "heuristic", label: "Local Context Only (0ms)" },
              ] as const
            ).map((opt) => (
              <Pressable key={opt.id} accessibilityRole="button" onPress={() => setMode(opt.id)} style={chipStyle(mode === opt.id)}>
                <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: mode === opt.id ? "600" : "400" }}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={{ gap: 6 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" }}>
            Paseo AI Provider (used automatically when no API Key is set)
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {["auto", "codex", "cursor", "claude", "opencode", "copilot"].map((p) => (
              <Pressable
                key={p}
                accessibilityRole="button"
                onPress={() => setPaseoProvider(p)}
                style={chipStyle(paseoProvider === p)}
              >
                <Text style={{ color: theme.colors.foreground, fontSize: 11.5 }}>
                  {p === "auto" ? "Auto (Match Agent)" : p}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={paseoProvider}
            onChangeText={setPaseoProvider}
            placeholder="auto or provider / provider/model"
            style={{
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface0,
              color: theme.colors.foreground,
              fontSize: 12,
            }}
          />
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
          <View style={{ gap: 6 }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" }}>
              Suggestions per turn
            </Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {[2, 3, 4].map((n) => (
                <Pressable key={n} accessibilityRole="button" onPress={() => setMaxSuggestions(n)} style={chipStyle(maxSuggestions === n)}>
                  <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>{n}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={{ gap: 6 }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" }}>
              Language
            </Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {(
                [
                  { id: "auto", label: "Auto" },
                  { id: "zh", label: "中文" },
                  { id: "en", label: "English" },
                ] as const
              ).map((opt) => (
                <Pressable key={opt.id} accessibilityRole="button" onPress={() => setLanguage(opt.id)} style={chipStyle(language === opt.id)}>
                  <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </View>

      {/* Fast LLM Config */}
      <View
        style={{
          padding: 14,
          borderRadius: 12,
          backgroundColor: theme.colors.surface1,
          borderWidth: 1,
          borderColor: theme.colors.border,
          gap: 10,
        }}
      >
        <Text style={{ color: theme.colors.foreground, fontWeight: "600", fontSize: 14 }}>
          Fast LLM Provider (OpenAI-Compatible / Ollama)
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          Optional. Leave empty to use the instant local engine (or set OPENAI_API_KEY in the daemon env).
        </Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {LLM_PRESETS.map((p) => (
            <Pressable
              key={p.label}
              accessibilityRole="button"
              onPress={() => {
                setApiBaseUrl(p.baseUrl);
                setModel(p.model);
              }}
              style={chipStyle(apiBaseUrl === p.baseUrl)}
            >
              <Text style={{ color: theme.colors.foreground, fontSize: 11.5 }}>{p.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ gap: 4 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>API Base URL</Text>
          <TextInput
            value={apiBaseUrl}
            onChangeText={setApiBaseUrl}
            placeholder="https://api.openai.com/v1"
            style={{
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface0,
              color: theme.colors.foreground,
              fontSize: 12,
            }}
          />
        </View>

        <View style={{ gap: 4 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Model</Text>
          <TextInput
            value={model}
            onChangeText={setModel}
            placeholder="gpt-4o-mini"
            style={{
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface0,
              color: theme.colors.foreground,
              fontSize: 12,
            }}
          />
        </View>

        <View style={{ gap: 4 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            API Key {configQuery.data?.hasApiKey ? `(Saved: ${configQuery.data.apiKeyPreview})` : "(Not set)"}
          </Text>
          <TextInput
            value={apiKeyInput}
            onChangeText={setApiKeyInput}
            secureTextEntry
            placeholder={
              configQuery.data?.hasApiKey
                ? "Enter a new key to replace, or leave blank to keep current"
                : "sk-... (optional for local Ollama)"
            }
            style={{
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface0,
              color: theme.colors.foreground,
              fontSize: 12,
            }}
          />
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          <Pressable
            accessibilityRole="button"
            disabled={saveMutation.isPending}
            onPress={() => saveMutation.mutate(false)}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: 8,
              backgroundColor: theme.colors.accent,
              opacity: saveMutation.isPending ? 0.6 : 1,
            }}
          >
            <Text style={{ color: theme.colors.accentForeground, fontWeight: "700", fontSize: 13 }}>
              {saveMutation.isPending ? "Saving..." : "Save Settings"}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={testMutation.isPending}
            onPress={() => testMutation.mutate()}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface0,
              opacity: testMutation.isPending ? 0.6 : 1,
            }}
          >
            <Text style={{ color: theme.colors.foreground, fontWeight: "600", fontSize: 13 }}>
              {testMutation.isPending ? "Testing..." : "Test LLM"}
            </Text>
          </Pressable>

          {configQuery.data?.hasApiKey ? (
            <Pressable
              accessibilityRole="button"
              disabled={saveMutation.isPending}
              onPress={() => saveMutation.mutate(true)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface0,
              }}
            >
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Clear Key</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}
