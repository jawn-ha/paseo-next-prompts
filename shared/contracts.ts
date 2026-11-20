import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const NextPromptItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  prompt: z.string(),
  reason: z.string().optional(),
});

export type NextPromptItem = z.infer<typeof NextPromptItemSchema>;

export const NextPromptsEngineSchema = z.enum(["llm", "paseo", "heuristic"]);
export type NextPromptsEngine = z.infer<typeof NextPromptsEngineSchema>;

export const NextPromptsTimelineSchema = z.object({
  turnId: z.string(),
  engine: NextPromptsEngineSchema,
  model: z.string().optional(),
  generatedAt: z.string(),
  suggestions: z.array(NextPromptItemSchema),
});

export type NextPromptsTimelineData = z.infer<typeof NextPromptsTimelineSchema>;

export const NextPromptsModeSchema = z.enum(["auto", "paseo", "llm", "heuristic"]);
export type NextPromptsMode = z.infer<typeof NextPromptsModeSchema>;

export const NextPromptsDisplayModeSchema = z.enum(["composer", "timeline", "both"]);
export type NextPromptsDisplayMode = z.infer<typeof NextPromptsDisplayModeSchema>;

export const NextPromptsLanguageSchema = z.enum(["auto", "zh", "en"]);
export type NextPromptsLanguage = z.infer<typeof NextPromptsLanguageSchema>;

export const NextPromptsConfigPublicSchema = z.object({
  enabled: z.boolean(),
  mode: NextPromptsModeSchema,
  displayMode: NextPromptsDisplayModeSchema,
  maxSuggestions: z.number().int().min(1).max(5),
  language: NextPromptsLanguageSchema,
  paseoProvider: z.string(),
  apiBaseUrl: z.string(),
  model: z.string(),
  hasApiKey: z.boolean(),
  apiKeyPreview: z.string(),
  skipBackgroundAgents: z.boolean(),
});

export type NextPromptsConfigPublic = z.infer<typeof NextPromptsConfigPublicSchema>;

export const getNextPromptsConfigRpc = defineRpc({
  name: "next_prompts.config.get",
  input: z.object({}),
  output: NextPromptsConfigPublicSchema,
});

export const saveNextPromptsConfigRpc = defineRpc({
  name: "next_prompts.config.save",
  input: z.object({
    enabled: z.boolean().optional(),
    mode: NextPromptsModeSchema.optional(),
    displayMode: NextPromptsDisplayModeSchema.optional(),
    maxSuggestions: z.number().int().min(1).max(5).optional(),
    language: NextPromptsLanguageSchema.optional(),
    paseoProvider: z.string().trim().optional(),
    apiBaseUrl: z.string().trim().optional(),
    model: z.string().trim().optional(),
    apiKey: z.string().optional(),
    clearApiKey: z.boolean().optional(),
    skipBackgroundAgents: z.boolean().optional(),
  }),
  output: NextPromptsConfigPublicSchema,
});

export const testNextPromptsLlmRpc = defineRpc({
  name: "next_prompts.llm.test",
  input: z.object({}),
  output: z.object({
    ok: z.boolean(),
    latencyMs: z.number(),
    model: z.string(),
    sampleCount: z.number().optional(),
    error: z.string().optional(),
  }),
});

export const generateNextPromptsRpc = defineRpc({
  name: "next_prompts.generate",
  input: z.object({
    agentId: z.string().min(1),
    turnId: z.string().optional(),
    cwd: z.string().optional(),
    provider: z.string().optional(),
    previousPrompts: z.array(z.string()).optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    engine: NextPromptsEngineSchema,
    model: z.string().optional(),
    count: z.number(),
    error: z.string().optional(),
  }),
});

export const sendNextPromptRpc = defineRpc({
  name: "next_prompts.send",
  input: z.object({
    agentId: z.string().min(1),
    prompt: z.string().trim().min(1),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
});

export const COMPOSER_METADATA_KEY = "paseo-next-prompts";
export const SESSION_DISABLED_METADATA_KEY = "paseo-next-prompts-disabled";

export const setSessionNextPromptsEnabledRpc = defineRpc({
  name: "next_prompts.session.set_enabled",
  input: z.object({
    agentId: z.string().min(1),
    enabled: z.boolean(),
  }),
  output: z.object({
    ok: z.boolean(),
    disabled: z.boolean(),
  }),
});

export const optimizePromptRpc = defineRpc({
  name: "next_prompts.optimize",
  input: z.object({
    agentId: z.string().min(1),
    draft: z.string().trim().min(1),
    cwd: z.string().optional(),
    provider: z.string().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    optimized: z.string(),
    engine: NextPromptsEngineSchema,
    model: z.string().optional(),
    error: z.string().optional(),
  }),
});
