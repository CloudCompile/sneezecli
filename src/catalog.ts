// Full model catalog from the free-provider registry (2026-09-14).
// 107 models across 7 providers. No model ids are hardcoded anywhere else —
// the pool config references these by provider + model id.
//
// rpm: per-model RPM limit (undefined = no documented limit)
// tags: capability hints used by `sneezecli models` filtering and routing
// ctx: context window in tokens (informational)

export interface CatalogModel {
  provider: string;
  model: string;
  rpm?: number;
  ctx?: number;
  tags?: string[];
  /** legacy source annotation; not used for routing */
  tier?: number;
}

export const CATALOG: CatalogModel[] = [
  // ── OpenRouter (tier 1 — 50 rpd account-wide, spend on hardest tasks) ──
  { provider: "openrouter", model: "thinkingmachines/inkling-small:free", rpm: 20, ctx: 1_000_000, tier: 1, tags: ["reasoning"] },
  { provider: "openrouter", model: "thinkingmachines/inkling:free", rpm: 20, ctx: 1_000_000, tier: 1, tags: ["reasoning"] },
  { provider: "openrouter", model: "inclusionai/ling-3.0-flash-vl:free", rpm: 20, ctx: 262_144, tier: 1, tags: ["vision"] },
  { provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free", rpm: 20, ctx: 1_000_000, tier: 1, tags: ["reasoning", "code"] },
  { provider: "openrouter", model: "google/gemma-4-26b-a4b-it:free", rpm: 20, ctx: 262_144, tier: 1, tags: ["general"] },
  { provider: "openrouter", model: "google/gemma-4-31b-it:free", rpm: 20, ctx: 1_000_000, tier: 1, tags: ["general"] },
  { provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free", rpm: 20, ctx: 1_000_000, tier: 1, tags: ["fast"] },
  { provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free", rpm: 20, ctx: 262_144, tier: 1, tags: ["code"] },
  { provider: "openrouter", model: "cohere/north-mini-code:free", rpm: 20, ctx: 262_144, tier: 1, tags: ["code"] },
  { provider: "openrouter", model: "liquid/lfm-2.5-2.6b:free", rpm: 20, ctx: 65_536, tier: 2, tags: ["fast"] },
  { provider: "openrouter", model: "dots-studio/dots-3-note-preview:free", rpm: 20, ctx: 512_000, tier: 1, tags: ["general"] },
  { provider: "openrouter", model: "nex-agi/nex-n2.5-mini:free", rpm: 20, ctx: 262_144, tier: 2, tags: ["fast"] },
  { provider: "openrouter", model: "inclusionai/ling-3.0-flash-sante:free", rpm: 20, ctx: 262_144, tier: 2, tags: ["general"] },
  { provider: "openrouter", model: "inclusionai/ling-3.0-flash-fin:free", rpm: 20, ctx: 262_144, tier: 2, tags: ["general"] },
  { provider: "openrouter", model: "poolside/laguna-s-2.1:free", rpm: 20, ctx: 262_144, tier: 1, tags: ["code"] },
  { provider: "openrouter", model: "poolside/laguna-xs-2.1:free", rpm: 20, ctx: 262_144, tier: 2, tags: ["code"] },
  { provider: "openrouter", model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", rpm: 20, ctx: 262_144, tier: 2, tags: ["reasoning"] },
  { provider: "openrouter", model: "nvidia/nemotron-3.5-content-safety:free", rpm: 20, ctx: 131_072, tier: 3, tags: ["safety"] },

  // ── InceptionLabs (tier 2 — 100M one-time token budget shared) ──
  { provider: "inceptionlabs", model: "mercury-2", rpm: 1000, tier: 2, tags: ["code", "fast"] },
  { provider: "inceptionlabs", model: "mercury-2.5", rpm: 1000, tier: 2, tags: ["code", "fast"] },

  // ── TokenReply (tier 2 — 3 RPM across ALL models, varying uptime) ──
  { provider: "tokenreply", model: "openai/gpt-oss-20b", rpm: 3, tier: 3, tags: ["general"] },
  { provider: "tokenreply", model: "meta/llama-3.2-11b-vision-instruct", rpm: 3, tier: 3, tags: ["vision"] },
  { provider: "tokenreply", model: "meta/muse-glimmer-30b", rpm: 3, tier: 3, tags: ["general"] },
  { provider: "tokenreply", model: "grok-4.20-fast", rpm: 3, tier: 2, tags: ["general"] },
  { provider: "tokenreply", model: "nvidia/ising-calibration-1.5-31b", rpm: 3, tier: 3, tags: ["general"] },
  { provider: "tokenreply", model: "nvidia/nemotron-3-super-120b-a12b", rpm: 3, tier: 2, tags: ["code"] },
  { provider: "tokenreply", model: "dots-3-note-preview", rpm: 3, tier: 2, tags: ["general"] },
  { provider: "tokenreply", model: "lfm-2.5-2.6b", rpm: 3, tier: 4, tags: ["fast"] },
  { provider: "tokenreply", model: "nvidia/nemotron-3.5-lightning-30b-a3b", rpm: 3, tier: 3, tags: ["fast"] },
  { provider: "tokenreply", model: "north-mini-code", rpm: 3, tier: 2, tags: ["code"] },
  { provider: "tokenreply", model: "deepseek-ai/deepseek-v4-pro-0813", rpm: 3, tier: 2, tags: ["code", "reasoning"] },
  { provider: "tokenreply", model: "google/gemma-4-26b-a4b-it", rpm: 3, tier: 3, tags: ["general"] },
  { provider: "tokenreply", model: "openai/gpt-oss-120b", rpm: 3, tier: 2, tags: ["general", "code"] },
  { provider: "tokenreply", model: "ling-3.0-flash-fin-free", rpm: 3, tier: 3, tags: ["general"] },
  { provider: "tokenreply", model: "laguna-s-2.1", rpm: 3, tier: 2, tags: ["code"] },
  { provider: "tokenreply", model: "laguna-xs-2.1", rpm: 3, tier: 3, tags: ["code"] },
  { provider: "tokenreply", model: "nvidia/nemotron-3-nano-30b-a3b", rpm: 3, tier: 3, tags: ["general"] },
  { provider: "tokenreply", model: "nvidia/nemotron-3-nano-30b-a3b-reasoning", rpm: 3, tier: 3, tags: ["reasoning"] },
  { provider: "tokenreply", model: "moonshotai/kimi-k3", rpm: 3, tier: 2, tags: ["code", "reasoning"] },
  { provider: "tokenreply", model: "nvidia/nemotron-3-ultra-550b-a55b", rpm: 3, tier: 2, tags: ["reasoning", "code"] },
  { provider: "tokenreply", model: "google/gemma-4-31b-it", rpm: 3, tier: 3, tags: ["general"] },
  { provider: "tokenreply", model: "google/diffusiongemma-26b-a4b-it", rpm: 3, tier: 3, tags: ["general"] },
  { provider: "tokenreply", model: "nemotron-3.5-lightning-free", rpm: 3, tier: 3, tags: ["fast"] },
  { provider: "tokenreply", model: "big-pickle-thinking-free", rpm: 3, tier: 3, tags: ["reasoning"] },
  { provider: "tokenreply", model: "meta/llama-3.2-90b-vision-instruct", rpm: 3, tier: 3, tags: ["vision"] },
  { provider: "tokenreply", model: "mimo-v2.5-free", rpm: 3, tier: 3, tags: ["general"] },
  { provider: "tokenreply", model: "nemotron-3-ultra-free", rpm: 3, tier: 2, tags: ["reasoning"] },
  { provider: "tokenreply", model: "big-pickle-free", rpm: 3, tier: 3, tags: ["general"] },
  { provider: "tokenreply", model: "nemotron-3-ultra-thinking-free", rpm: 3, tier: 2, tags: ["reasoning"] },
  { provider: "tokenreply", model: "mimo-v2.5-thinking-free", rpm: 3, tier: 3, tags: ["reasoning"] },
  { provider: "tokenreply", model: "deepseek-ai/deepseek-v4-flash", rpm: 3, tier: 3, tags: ["fast"] },
  { provider: "tokenreply", model: "deepseek-ai/deepseek-v4-flash-0731", rpm: 3, tier: 3, tags: ["fast"] },
  { provider: "tokenreply", model: "nemotron-3.5-lightning-thinking-free", rpm: 3, tier: 3, tags: ["reasoning"] },
  { provider: "tokenreply", model: "grok-4.20-0309-non-reasoning", rpm: 3, tier: 3, tags: ["general"] },
  { provider: "tokenreply", model: "grok-4.20-0309-reasoning", rpm: 3, tier: 2, tags: ["reasoning"] },
  { provider: "tokenreply", model: "grok-4.20-multi-agent-0309", rpm: 3, tier: 2, tags: ["reasoning"] },
  { provider: "tokenreply", model: "grok-4.20-multi-agent-high", rpm: 3, tier: 2, tags: ["reasoning"] },
  { provider: "tokenreply", model: "grok-4.20-multi-agent-low", rpm: 3, tier: 3, tags: ["reasoning"] },
  { provider: "tokenreply", model: "grok-4.20-multi-agent-medium", rpm: 3, tier: 3, tags: ["reasoning"] },
  { provider: "tokenreply", model: "grok-4.3", rpm: 3, tier: 2, tags: ["general", "code"] },
  { provider: "tokenreply", model: "grok-4.3-high", rpm: 3, tier: 2, tags: ["reasoning"] },
  { provider: "tokenreply", model: "grok-4.3-low", rpm: 3, tier: 3, tags: ["general"] },
  { provider: "tokenreply", model: "grok-4.3-medium", rpm: 3, tier: 3, tags: ["general"] },
  { provider: "tokenreply", model: "grok-build-0.1", rpm: 3, tier: 2, tags: ["code"] },

  // ── Requesty.AI (tier 2 — 200 RPD account-wide, no RPM limit) ──
  { provider: "requesty", model: "nemotron-3.5-lightning-30b-a3b", tier: 3, tags: ["fast"] },
  { provider: "requesty", model: "muse-glimmer-30b", tier: 3, tags: ["general"] },
  { provider: "requesty", model: "ling-3.0-tiny", tier: 3, tags: ["fast"] },
  { provider: "requesty", model: "nemotron-3.5-content-safety", tier: 4, tags: ["safety"] },
  { provider: "requesty", model: "nemotron-3-nano-omni-30b-a3b-reasoning", tier: 3, tags: ["reasoning"] },
  { provider: "requesty", model: "laguna-m.1", tier: 2, tags: ["code"] },
  { provider: "requesty", model: "laguna-xs.2", tier: 3, tags: ["code"] },
  { provider: "requesty", model: "nemotron-3-ultra-550b-a55b", tier: 2, tags: ["reasoning", "code"] },
  { provider: "requesty", model: "leanstral-1-5", tier: 3, tags: ["general"] },
  { provider: "requesty", model: "gemma-4-31b-it", tier: 3, tags: ["general"] },
  { provider: "requesty", model: "nemotron-3-super-120b-a12b", tier: 2, tags: ["code"] },
  { provider: "requesty", model: "nemotron-3-nano-30b-a3b", tier: 3, tags: ["general"] },

  // ── Logfare (tier 2 — 20 RPM account-wide, no daily cap) ──
  { provider: "logfare", model: "gemma-4-26b", tier: 3, tags: ["general"] },
  { provider: "logfare", model: "glm-5.3", tier: 2, tags: ["code", "reasoning"] },
  { provider: "logfare", model: "kimi-k2.6", tier: 2, tags: ["code"] },
  { provider: "logfare", model: "kimi-k3", tier: 2, tags: ["code", "reasoning"] },
  { provider: "logfare", model: "logfare/auto", tier: 2, tags: ["router"] },
  { provider: "logfare", model: "mimo-v2.5", tier: 3, tags: ["general"] },
  { provider: "logfare", model: "moondream3.1", tier: 3, tags: ["vision"] },
  { provider: "logfare", model: "qwen-3.8-27b", tier: 3, tags: ["general"] },

  // ── Pollinations gen (tier 3 — unlimited, per-model RPM) ──
  { provider: "pollinations", model: "community/chigwell/llm7-fast", rpm: 300, tier: 3, tags: ["fast", "workhorse"] },
  { provider: "pollinations", model: "community/morriszdweck/osaii-api-fast", rpm: 30, tier: 3, tags: ["fast"] },
  { provider: "pollinations", model: "community/morriszdweck/osaii-api-smart", rpm: 15, tier: 3, tags: ["general"] },
  { provider: "pollinations", model: "community/YoannDev90/muse-glimmer-30b:free", rpm: 10, tier: 3, tags: ["general"] },
  { provider: "pollinations", model: "community/scriptsnsenses-sys/muse-spark-1.2-contributor-free", rpm: 8, tier: 3, tags: ["general"] },
  { provider: "pollinations", model: "community/scriptsnsenses-sys/glm-5.3-flash-free", rpm: 8, tier: 3, tags: ["fast"] },
  { provider: "pollinations", model: "community/scriptsnsenses-sys/gpt-5.6-luna", rpm: 8, tier: 3, tags: ["general"] },
  { provider: "pollinations", model: "community/pegalink/jimmy", rpm: 5, tier: 4, tags: ["general"] },
  { provider: "pollinations", model: "community/vendouple/muse-glimmer-30b:free", rpm: 5, tier: 4, tags: ["general"] },
  { provider: "pollinations", model: "community/NamanSoni78/nemotron-3-ultra-550b-a55b", tier: 3, tags: ["reasoning"] },
  { provider: "pollinations", model: "community/NamanSoni78/gpt-5.4-nano", tier: 4, tags: ["fast"] },
  { provider: "pollinations", model: "community/NamanSoni78/nova-3", tier: 4, tags: ["general"] },
  { provider: "pollinations", model: "community/NamanSoni78/whisper-large-v3", tier: 4, tags: ["asr"] },
  { provider: "pollinations", model: "community/NamanSoni78/whisper-large-v3-turbo", tier: 4, tags: ["asr"] },
  { provider: "pollinations", model: "community/NamanSoni78/llama-nemotron-embed-vl-1b-v2", tier: 4, tags: ["embed"] },
  { provider: "pollinations", model: "community/NamanSoni78/FISH-AUDIO-S2.1-PRO", tier: 4, tags: ["tts"] },
  { provider: "pollinations", model: "community/NamanSoni78/aura-2-thalia-en", tier: 4, tags: ["tts"] },
  { provider: "pollinations", model: "community/NamanSoni78/aura-2-orpheus-en", tier: 4, tags: ["tts"] },
  { provider: "pollinations", model: "community/NamanSoni78/aura-2-atlas-en", tier: 4, tags: ["tts"] },
  { provider: "pollinations", model: "community/NamanSoni78/Imagine-4", tier: 4, tags: ["image"] },
  { provider: "pollinations", model: "community/NamanSoni78/Z-Image-Turbo", tier: 4, tags: ["image"] },
  { provider: "pollinations", model: "community/Spit-fires/muse-glimmer", tier: 4, tags: ["general"] },

  // ── Pollinations no-auth (tier 4 — GET endpoint, no key, always-on) ──
  { provider: "pollinations-noauth", model: "openai", tier: 5, tags: ["fallback", "no-tools"] },
];

export function catalogFor(provider: string): CatalogModel[] {
  return CATALOG.filter((m) => m.provider === provider);
}

export function findCatalogModel(provider: string, model: string): CatalogModel | undefined {
  return CATALOG.find((m) => m.provider === provider && m.model === model);
}
