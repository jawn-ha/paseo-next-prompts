import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  clearComposerSuggestions,
  generateAndAppendNextPrompts,
  getPublicConfig,
  isHelperAgent,
  optimizeUserPrompt,
  savePublicConfig,
  shouldSkipBackground,
  testLlmConnection,
} from "./server/suggester";
import {
  generateNextPromptsRpc,
  getNextPromptsConfigRpc,
  optimizePromptRpc,
  saveNextPromptsConfigRpc,
  sendNextPromptRpc,
  testNextPromptsLlmRpc,
} from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  const processedTurns = new Set<string>();

  const removeBeforeHook = server.addHook("agent.turn.before", async ({ agent }, { paseo }) => {
    if (isHelperAgent(agent)) return;
    if (agent.background && shouldSkipBackground()) return;
    await clearComposerSuggestions(paseo, agent.id);
  });

  const removeAfterHook = server.addHook("agent.turn.after", async ({ agent, turnId, outcome }, { paseo }) => {
    if (isHelperAgent(agent)) return;
    if (outcome.kind === "canceled") return;
    if (agent.background && shouldSkipBackground()) return;
    if (!turnId) return;

    const key = `${agent.id}:${turnId}`;
    if (processedTurns.has(key)) return;
    processedTurns.add(key);
    if (processedTurns.size > 300) {
      const first = processedTurns.values().next().value;
      if (first) processedTurns.delete(first);
    }

    try {
      await generateAndAppendNextPrompts({
        paseo,
        agentId: agent.id,
        turnId,
        cwd: agent.cwd,
        provider: agent.provider,
        turnFailed: outcome.kind === "failed",
      });
    } catch {
      // Never disturb the user's turn on background suggestion failure
    }
  });

  server.handle(getNextPromptsConfigRpc, () => getPublicConfig());
  server.handle(saveNextPromptsConfigRpc, (input) => savePublicConfig(input));
  server.handle(testNextPromptsLlmRpc, () => testLlmConnection());
  server.handle(generateNextPromptsRpc, (input, { paseo }) =>
    generateAndAppendNextPrompts({
      paseo,
      agentId: input.agentId,
      turnId: input.turnId,
      cwd: input.cwd,
      provider: input.provider,
      previousPrompts: input.previousPrompts,
      force: true,
    }),
  );
  server.handle(sendNextPromptRpc, async (input, { paseo }) => {
    await clearComposerSuggestions(paseo, input.agentId);
    await paseo.agents.ref(input.agentId).send(input.prompt);
    return { ok: true };
  });
  server.handle(optimizePromptRpc, (input, { paseo }) =>
    optimizeUserPrompt({
      paseo,
      agentId: input.agentId,
      draft: input.draft,
      cwd: input.cwd,
      provider: input.provider,
    }),
  );

  return () => {
    removeBeforeHook();
    removeAfterHook();
  };
}
