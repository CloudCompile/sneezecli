// Closed provider registry. The curated free-provider list is maintained here
// (more coming). NO model names — model ids are supplied by the user per provider.
export const PROVIDERS = {
    openrouter: {
        id: "openrouter",
        name: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        keyEnv: "OPENROUTER_API_KEY",
        limits: { rpd: 50 },
        notes: "Best model quality. 50 req/day hard cap — ration for hard tasks.",
    },
    pollinations: {
        id: "pollinations",
        name: "Pollinations",
        baseUrl: "https://gen.pollinations.ai/v1",
        keyEnv: "POLLINATIONS_API_KEY",
        limits: { rpm: 8 },
        notes: "Unlimited requests, rpm-throttled per model. Round-robin models to multiply throughput.",
    },
    poolside: {
        id: "poolside",
        name: "Poolside",
        baseUrl: "https://api.poolside.ai/v1",
        keyEnv: "POOLSIDE_API_KEY",
        limits: {},
        notes: "Free tier, dynamic undocumented rate limits.",
    },
    inceptionlabs: {
        id: "inceptionlabs",
        name: "InceptionLabs",
        baseUrl: "https://api.inceptionlabs.ai/v1",
        keyEnv: "INCEPTIONLABS_API_KEY",
        limits: { rpm: 1000, tpmIn: 1_000_000, tpmOut: 100_000, totalTokens: 100_000_000 },
        notes: "100M one-time token budget shared across models. A tank of gas, not a rate limit.",
    },
    tokenrouter: {
        id: "tokenrouter",
        name: "TokenRouter",
        baseUrl: "https://api.tokenrouter.ai/v1",
        keyEnv: "TOKENROUTER_API_KEY",
        limits: {},
        notes: "Free models, no known limit, may vanish at any time.",
    },
    tokenreply: {
        id: "tokenreply",
        name: "TokenReply",
        baseUrl: "https://api.tokenreply.ai/v1",
        keyEnv: "TOKENREPLY_API_KEY",
        limits: { rpm: 3 },
        notes: "Many free models, 3 rpm, varying uptime.",
    },
    mock: {
        id: "mock",
        name: "Mock",
        baseUrl: "http://mock.local/v1",
        keyEnv: "MOCK_API_KEY",
        limits: {},
        keyless: true,
        hidden: true,
        notes: "Dev-only. Set SNEEZE_MOCK=1 to script the agent loop without API keys.",
    },
};
export function visibleProviders() {
    return Object.values(PROVIDERS).filter((p) => !p.hidden);
}
