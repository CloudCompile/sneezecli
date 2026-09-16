// Closed provider registry — curated free-provider list (2026-09-14).
// Model ids live in catalog.ts; this file only defines endpoints + limits.

export type ProviderId =
  | "openrouter"
  | "inceptionlabs"
  | "tokenreply"
  | "requesty"
  | "logfare"
  | "pollinations"
  | "llmgateway"
  | "agnes"
  | "eden"
  | "poolside"
  | "orcarouter"
  | "mock";

export interface ProviderDef {
  id: ProviderId;
  name: string;
  /** OpenAI-compatible chat completions base URL (empty for special adapters) */
  baseUrl: string;
  /** env var name holding the API key */
  keyEnv: string;
  limits: Limits;
  keyless?: boolean;
  /** hidden from setup/help (dev only) */
  hidden?: boolean;
  notes: string;
}

export interface Limits {
  rpm?: number;
  rpd?: number;
  /** one-time token budget shared across models (e.g. InceptionLabs 100M) */
  totalTokens?: number;
  tpmIn?: number;
  tpmOut?: number;
  /**
   * Where the limit is metered: "provider" = shared across all models on the
   * account (e.g. TokenReply 3 rpm total, OpenRouter 50 rpd total),
   * "model" = per model (e.g. Pollinations per-model rpm). Default "model".
   */
  scope?: "provider" | "model";
}

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    limits: { rpm: 20, rpd: 50, scope: "provider" },
    notes:
      "Tier 1 — best free model selection. Hard 50 RPD + 20 RPM across the entire account. Spend on hardest tasks only.",
  },
  inceptionlabs: {
    id: "inceptionlabs",
    name: "InceptionLabs",
    baseUrl: "https://api.inceptionlabs.ai/v1",
    keyEnv: "INCEPTIONLABS_API_KEY",
    limits: {
      rpm: 1000,
      tpmIn: 1_000_000,
      tpmOut: 100_000,
      totalTokens: 100_000_000,
      scope: "provider",
    },
    notes:
      "Tier 2 — 100M one-time token budget shared across models. Output TPM (100K) is the real bottleneck. Drains in ~1.5h at full burn.",
  },
  tokenreply: {
    id: "tokenreply",
    name: "TokenReply",
    baseUrl: "https://api.tokenreply.com/v1",
    keyEnv: "TOKENREPLY_API_KEY",
    limits: { rpm: 3, scope: "provider" },
    notes:
      "Tier 2 — 44 free models but 3 RPM cap across ALL models at any given time. Varying uptime.",
  },
  requesty: {
    id: "requesty",
    name: "Requesty.AI",
    baseUrl: "https://router.requesty.ai/v1",
    keyEnv: "REQUESTY_API_KEY",
    limits: { rpd: 200, scope: "provider" },
    notes: "Tier 2 — no RPM limit, 200 RPD account-wide. Good burst capacity.",
  },
  logfare: {
    id: "logfare",
    name: "Logfare",
    baseUrl: "https://logfare.ai/v1",
    keyEnv: "LOGFARE_API_KEY",
    limits: { rpm: 20, scope: "provider" },
    notes: "Tier 2 — 20 RPM account-wide, no daily cap. Has logfare/auto router model.",
  },
  pollinations: {
    id: "pollinations",
    name: "Pollinations (gen)",
    baseUrl: "https://gen.pollinations.ai/v1",
    keyEnv: "POLLINATIONS_API_KEY",
    limits: { scope: "model" },
    notes:
      "Tier 3 — all models unlimited (no daily cap), per-model RPM limits. Round-robin across models to multiply throughput.",
  },
  llmgateway: {
    id: "llmgateway",
    name: "LLMGateway",
    baseUrl: "https://api.llmgateway.io/v1",
    keyEnv: "LLMGATEWAY_API_KEY",
    limits: { scope: "model" },
    notes: "Tier 1 — Atria Dawn preview with no documented rate limit.",
  },
  agnes: {
    id: "agnes",
    name: "Agnes AI",
    baseUrl: "https://apihub.agnes-ai.com/v1",
    keyEnv: "AGNES_API_KEY",
    limits: { rpm: 20, scope: "provider" },
    notes: "Tier 2 — 20 RPM account-wide.",
  },
  eden: {
    id: "eden",
    name: "Eden AI",
    baseUrl: "https://api.edenai.run/v3",
    keyEnv: "EDEN_API_KEY",
    limits: { rpm: 60, scope: "provider" },
    notes: "Tier 2 — v3 OpenAI-compatible chat completions endpoint, 60 RPM.",
  },
  poolside: {
    id: "poolside",
    name: "Poolside",
    baseUrl: "https://inference.poolside.ai/v1",
    keyEnv: "POOLSIDE_API_KEY",
    limits: { scope: "provider" },
    notes: "Tier 2 — dynamic limits; no documented RPM or RPD cap.",
  },
  orcarouter: {
    id: "orcarouter",
    name: "OrcaRouter",
    baseUrl: "https://api.orcarouter.ai/v1",
    keyEnv: "ORCAROUTER_API_KEY",
    limits: { rpm: 20, scope: "provider" },
    notes: "Tier 2 — 20 RPM account-wide.",
  },
  mock: {
    id: "mock",
    name: "Mock",
    baseUrl: "http://mock.local/v1",
    keyEnv: "MOCK_API_KEY",
    limits: {},
    keyless: true,
    hidden: true,
    notes: "Dev-only. Set HARMONY_MOCK=1 to script the agent loop without API keys.",
  },
};

export function visibleProviders(): ProviderDef[] {
  return Object.values(PROVIDERS).filter((p) => !p.hidden);
}
