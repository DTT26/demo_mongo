'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 31 * DAY_MS;

const INPUT_TOKEN_COST_ESTIMATE = 0.00000015;
const OUTPUT_TOKEN_COST_ESTIMATE = 0.0000006;

const createEmptyStats = (now = Date.now()) => ({
  startedAt: new Date(now).toISOString(),
  requests: {
    total: 0,
    byRole: {},
    byMode: {},
    byStatus: {},
    byErrorCode: {},
  },
  tools: {
    total: 0,
    byTool: {},
    byStatus: {},
    byErrorCode: {},
  },
  providers: {
    byProvider: {},
    failuresByProvider: {},
    fallbackByReason: {},
  },
  rateLimitHits: 0,
  providerFailures: 0,
  fallbackCount: 0,
  latencyMs: {
    total: 0,
    count: 0,
    max: 0,
  },
  tokenUsage: {
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
    byProvider: {},
  },
  windows: {
    daily: { startedAt: now, estimatedCost: 0 },
    monthly: { startedAt: now, estimatedCost: 0 },
  },
});

const increment = (bucket, key, amount = 1) => {
  const normalized = key || 'unknown';
  bucket[normalized] = (bucket[normalized] || 0) + amount;
};

const normalizeUsage = (usage = {}) => ({
  inputTokens: Math.max(0, Number(usage.inputTokens) || 0),
  outputTokens: Math.max(0, Number(usage.outputTokens) || 0),
});

const estimateCost = (usage = {}) => {
  const normalized = normalizeUsage(usage);
  return Number((
    normalized.inputTokens * INPUT_TOKEN_COST_ESTIMATE
    + normalized.outputTokens * OUTPUT_TOKEN_COST_ESTIMATE
  ).toFixed(8));
};

const createAiObservabilityService = ({ nowProvider = () => Date.now() } = {}) => {
  let stats = createEmptyStats(nowProvider());

  const rotateWindows = () => {
    const now = nowProvider();
    if (now - stats.windows.daily.startedAt >= DAY_MS) {
      stats.windows.daily = { startedAt: now, estimatedCost: 0 };
    }
    if (now - stats.windows.monthly.startedAt >= MONTH_MS) {
      stats.windows.monthly = { startedAt: now, estimatedCost: 0 };
    }
  };

  const recordTokenUsage = (usage = {}, providerUsed = 'unknown') => {
    rotateWindows();
    const normalized = normalizeUsage(usage);
    const cost = estimateCost(normalized);
    stats.tokenUsage.inputTokens += normalized.inputTokens;
    stats.tokenUsage.outputTokens += normalized.outputTokens;
    stats.tokenUsage.estimatedCost = Number((stats.tokenUsage.estimatedCost + cost).toFixed(8));
    const provider = providerUsed || 'unknown';
    const providerUsage = stats.tokenUsage.byProvider[provider] || {
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
    };
    providerUsage.inputTokens += normalized.inputTokens;
    providerUsage.outputTokens += normalized.outputTokens;
    providerUsage.estimatedCost = Number((providerUsage.estimatedCost + cost).toFixed(8));
    stats.tokenUsage.byProvider[provider] = providerUsage;
    stats.windows.daily.estimatedCost = Number((stats.windows.daily.estimatedCost + cost).toFixed(8));
    stats.windows.monthly.estimatedCost = Number((stats.windows.monthly.estimatedCost + cost).toFixed(8));
    return { ...normalized, estimatedCost: cost };
  };

  const isBudgetExceeded = (config = {}) => {
    rotateWindows();
    const dailyBudget = Number(config.dailyBudgetEstimate) || 0;
    const monthlyBudget = Number(config.monthlyBudgetEstimate) || 0;
    const dailyExceeded = dailyBudget > 0 && stats.windows.daily.estimatedCost >= dailyBudget;
    const monthlyExceeded = monthlyBudget > 0 && stats.windows.monthly.estimatedCost >= monthlyBudget;
    return {
      exceeded: dailyExceeded || monthlyExceeded,
      dailyExceeded,
      monthlyExceeded,
      dailyEstimatedCost: stats.windows.daily.estimatedCost,
      monthlyEstimatedCost: stats.windows.monthly.estimatedCost,
    };
  };

  const recordRequest = ({
    role = 'guest',
    mode = 'customer',
    status = 'success',
    errorCode = null,
    latencyMs = 0,
    usage = null,
    fallback = false,
    providerUsed = 'unknown',
    fallbackReason = null,
  } = {}) => {
    stats.requests.total += 1;
    increment(stats.requests.byRole, role);
    increment(stats.requests.byMode, mode);
    increment(stats.requests.byStatus, status);
    if (errorCode) increment(stats.requests.byErrorCode, errorCode);
    increment(stats.providers.byProvider, providerUsed || 'unknown');
    if (errorCode && String(errorCode).startsWith('AI_')) stats.providerFailures += 1;
    if (fallback) {
      stats.fallbackCount += 1;
      increment(stats.providers.fallbackByReason, fallbackReason || 'unknown');
      increment(stats.providers.failuresByProvider, providerUsed === 'groq' ? 'openai' : 'unknown');
      stats.providerFailures += 1;
    }
    const latency = Math.max(0, Number(latencyMs) || 0);
    stats.latencyMs.total += latency;
    stats.latencyMs.count += 1;
    stats.latencyMs.max = Math.max(stats.latencyMs.max, latency);
    const tokenUsage = usage ? recordTokenUsage(usage, providerUsed) : null;
    return tokenUsage;
  };

  const recordToolCall = ({
    toolName,
    status = 'success',
    errorCode = null,
  } = {}) => {
    stats.tools.total += 1;
    increment(stats.tools.byTool, toolName);
    increment(stats.tools.byStatus, status);
    if (errorCode) increment(stats.tools.byErrorCode, errorCode);
  };

  const recordRateLimitHit = ({ role = 'guest' } = {}) => {
    stats.rateLimitHits += 1;
    increment(stats.requests.byRole, role, 0);
  };

  const getSnapshot = () => {
    rotateWindows();
    const averageLatencyMs = stats.latencyMs.count
      ? Math.round((stats.latencyMs.total / stats.latencyMs.count) * 10) / 10
      : 0;
    return {
      startedAt: stats.startedAt,
      requests: stats.requests,
      tools: stats.tools,
      providers: stats.providers,
      rateLimitHits: stats.rateLimitHits,
      providerFailures: stats.providerFailures,
      fallbackCount: stats.fallbackCount,
      latencyMs: {
        average: averageLatencyMs,
        max: Math.round(stats.latencyMs.max * 10) / 10,
      },
      tokenUsage: stats.tokenUsage,
      windows: {
        daily: {
          startedAt: new Date(stats.windows.daily.startedAt).toISOString(),
          estimatedCost: stats.windows.daily.estimatedCost,
        },
        monthly: {
          startedAt: new Date(stats.windows.monthly.startedAt).toISOString(),
          estimatedCost: stats.windows.monthly.estimatedCost,
        },
      },
    };
  };

  const reset = () => {
    stats = createEmptyStats(nowProvider());
  };

  return {
    estimateCost,
    getSnapshot,
    isBudgetExceeded,
    recordRateLimitHit,
    recordRequest,
    recordTokenUsage,
    recordToolCall,
    reset,
  };
};

const defaultAiObservabilityService = createAiObservabilityService();

module.exports = {
  createAiObservabilityService,
  defaultAiObservabilityService,
  estimateCost,
};
