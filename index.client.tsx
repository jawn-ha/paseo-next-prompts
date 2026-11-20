import type {
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { nextPromptsTranslations } from "./client/i18n";
import {
  NextPromptsComposerPopover,
  NextPromptsSettingsScreen,
  NextPromptsTimelineRenderer,
} from "./client/next-prompts-ui";
import {
  COMPOSER_METADATA_KEY,
  NextPromptsTimelineSchema,
  SESSION_DISABLED_METADATA_KEY,
  generateNextPromptsRpc,
  optimizePromptRpc,
  setSessionNextPromptsEnabledRpc,
} from "./shared/contracts";

export default function contribute(client: PluginClientContext) {
  const pillByAgent = new Map<string, PluginButtonRegistration>();
  const prefilledKeyByAgent = new Map<string, string>();
  const lastAutoPrefilledByAgent = new Map<string, string>();
  const lifetime = new AbortController();

  const clearAgentPill = (agentId: string) => {
    pillByAgent.get(agentId)?.remove();
    pillByAgent.delete(agentId);
  };

  const syncAgentSuggestions = (agent: {
    id: string;
    workspaceId?: string | null;
    metadata?: Record<string, unknown> | null;
  }) => {
    if (lifetime.signal.aborted) return;
    if (!agent.workspaceId) {
      clearAgentPill(agent.id);
      return;
    }

    const agentId = agent.id;
    const workspaceId = agent.workspaceId;

    // Always keep ONE ultra-compact "✨ Next" pill on active agents for both Prompt Optimization & Next Suggestions
    if (!pillByAgent.has(agentId)) {
      const reg = client.addComposerPill({
        id: "next-prompts-picker",
        workspaceId,
        agentId,
        button: {
          title: nextPromptsTranslations.message("pillTitle"),
          icon: "Sparkles",
          label: nextPromptsTranslations.message("pillLabel"),
          behavior: {
            kind: "popover",
            Content: NextPromptsComposerPopover,
          },
        },
      });
      pillByAgent.set(agentId, reg);
    }

    if (Boolean(agent.metadata?.[SESSION_DISABLED_METADATA_KEY])) {
      lastAutoPrefilledByAgent.delete(agentId);
      return;
    }

    const rawMeta = agent.metadata?.[COMPOSER_METADATA_KEY];
    if (!rawMeta || typeof rawMeta !== "object") {
      lastAutoPrefilledByAgent.delete(agentId);
      return;
    }
    const parsed = NextPromptsTimelineSchema.safeParse(rawMeta);
    if (!parsed.success || parsed.data.suggestions.length === 0) return;

    const { turnId, generatedAt, suggestions } = parsed.data;
    const suggestionKey = `${turnId}:${generatedAt}`;

    // Auto-prefill the #1 suggestion into the chat input box if empty,
    // or seamlessly upgrade it if the box still holds the untouched previous auto-prefill.
    if (prefilledKeyByAgent.get(agentId) !== suggestionKey) {
      const targetComposer = client.composers({ agentId })[0];
      if (targetComposer) {
        const currentPrompt = targetComposer.prompt.trim();
        const prevAuto = lastAutoPrefilledByAgent.get(agentId)?.trim();
        if (currentPrompt.length === 0 || (prevAuto && currentPrompt === prevAuto)) {
          targetComposer.setPrompt(suggestions[0].prompt);
          lastAutoPrefilledByAgent.set(agentId, suggestions[0].prompt);
        }
        prefilledKeyByAgent.set(agentId, suggestionKey);
      }
    }
  };

  const removeAllPills = () => {
    for (const pill of pillByAgent.values()) pill.remove();
    pillByAgent.clear();
  };

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          removeAllPills();
          for (const { agent } of entries) {
            syncAgentSuggestions(
              agent as { id: string; workspaceId?: string | null; metadata?: Record<string, unknown> | null },
            );
          }
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert") {
            syncAgentSuggestions(
              update.agent as { id: string; workspaceId?: string | null; metadata?: Record<string, unknown> | null },
            );
            return;
          }
          clearAgentPill(update.agentId);
          prefilledKeyByAgent.delete(update.agentId);
          lastAutoPrefilledByAgent.delete(update.agentId);
        },
      });
      return undefined;
    })
    .catch(() => {});

  const cleanups = [
    client.addTimelineRenderer({
      kind: "next-prompts",
      version: 1,
      schema: NextPromptsTimelineSchema,
      Component: NextPromptsTimelineRenderer,
    }),

    client.addSettingsScreen({
      id: "next-prompts",
      title: nextPromptsTranslations.message("settingsTitle"),
      icon: "Sparkles",
      Component: NextPromptsSettingsScreen,
    }),

    client.addCommandCenterItem({
      id: "open-next-prompts-settings",
      title: nextPromptsTranslations.message("cmdSettings"),
      icon: "Sparkles",
      context: "global",
      onSelect({ openSettings }) {
        openSettings("next-prompts");
      },
    }),

    client.addCommandCenterItem({
      id: "toggle-next-prompts-session",
      title: nextPromptsTranslations.message("cmdToggleSession"),
      icon: "Sparkles",
      context: "agent",
      async onSelect({ agent, rpc }) {
        const disabled = Boolean(
          (agent.metadata as Record<string, unknown> | null | undefined)?.[SESSION_DISABLED_METADATA_KEY],
        );
        await rpc(setSessionNextPromptsEnabledRpc, {
          agentId: agent.id,
          enabled: disabled,
        });
      },
    }),

    client.addCommandCenterItem({
      id: "optimize-current-prompt",
      title: nextPromptsTranslations.message("cmdOptimize"),
      icon: "Sparkles",
      context: "agent",
      async onSelect({ agent, rpc, composers }) {
        const composer = composers({ agentId: agent.id })[0];
        const draft = composer?.prompt?.trim() ?? "";
        if (!draft) return;
        const res = await rpc(optimizePromptRpc, {
          agentId: agent.id,
          draft,
          cwd: agent.cwd,
          provider: agent.provider,
        });
        if (res.ok && res.optimized) {
          composer.setPrompt(res.optimized);
          try {
            await composer.focus();
          } catch {}
        }
      },
    }),

    client.addSlashCommand({
      name: "next",
      description: nextPromptsTranslations.message("slashNextDesc"),
      argumentHint: "",
      context: "agent",
      async onSubmit({ agent, rpc }) {
        await rpc(generateNextPromptsRpc, {
          agentId: agent.id,
          cwd: agent.cwd,
          provider: agent.provider,
        });
      },
    }),

    client.addSlashCommand({
      name: "enhance",
      description: nextPromptsTranslations.message("slashEnhanceDesc"),
      argumentHint: nextPromptsTranslations.message("slashEnhanceHint"),
      context: "agent",
      async onSubmit({ args, agent, rpc, composers }) {
        const draft = args.trim();
        if (!draft) return;
        const res = await rpc(optimizePromptRpc, {
          agentId: agent.id,
          draft,
          cwd: agent.cwd,
          provider: agent.provider,
        });
        if (res.ok && res.optimized) {
          const composer = composers({ agentId: agent.id })[0];
          if (composer) {
            composer.setPrompt(res.optimized);
            try {
              await composer.focus();
            } catch {}
          }
        }
      },
    }),
  ];

  return () => {
    lifetime.abort();
    removeAllPills();
    for (const cleanup of cleanups) cleanup();
  };
}
