'use strict';

const { getAiConfig } = require('../config/ai.config');
const aiMockService = require('../services/ai/ai-mock.service');
const { defaultAiObservabilityService } = require('../services/ai/ai-observability.service');
const { createAiOrchestrator } = require('../services/ai/ai-orchestrator.service');
const { getProviderHealth, toPublicAiError } = require('../services/ai/ai-provider.service');
const aiStreamService = require('../services/ai/ai-stream.service');

const isMockEnabled = () => {
  if (process.env.AI_MOCK_ENABLED !== undefined) {
    return process.env.AI_MOCK_ENABLED.toLowerCase() === 'true';
  }

  return process.env.NODE_ENV !== 'production';
};

const isStreamMockFallbackEnabled = () => (
  process.env.AI_STREAM_MOCK_FALLBACK_ENABLED?.toLowerCase() === 'true'
  || process.env.AI_MOCK_ENABLED?.toLowerCase() === 'true'
);

const STREAM_MOCK_FALLBACK_CODES = new Set([
  'AI_AUTH_ERROR',
  'AI_RATE_LIMITED',
  'AI_UNAVAILABLE',
]);

const getProviderCauseForLog = (error) => {
  const cause = error?.cause || {};
  const parts = [];
  if (cause.provider) parts.push(`provider=${cause.provider}`);
  if (cause.status) parts.push(`providerStatus=${cause.status}`);
  if (cause.code) parts.push(`providerCode=${cause.code}`);
  if (cause.type) parts.push(`providerType=${cause.type}`);
  if (cause.param) parts.push(`providerParam=${cause.param}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
};

const validateMessage = (body, maxLength = 2000) => {
  if (!body || Array.isArray(body) || typeof body !== 'object') {
    return { error: 'Dữ liệu gửi lên phải là JSON object.' };
  }

  if (typeof body.message !== 'string') {
    return { error: 'message phải là chuỗi.' };
  }

  const message = body.message.trim();
  if (!message) {
    return { error: 'message không được để trống.' };
  }

  if (message.length > maxLength) {
    return { error: `message không được vượt quá ${maxLength} ký tự.` };
  }

  return { message };
};

const validatePageContext = (pageContext) => {
  if (pageContext === undefined) return { pageContext: null };

  if (!pageContext || Array.isArray(pageContext) || typeof pageContext !== 'object') {
    return { error: 'pageContext phải là object.' };
  }

  const allowedKeys = new Set(['route', 'restaurantId']);
  for (const key of Object.keys(pageContext)) {
    if (!allowedKeys.has(key)) {
      return { error: 'pageContext chứa field không được hỗ trợ.' };
    }
  }

  const route = typeof pageContext.route === 'string' ? pageContext.route.trim() : '';
  const restaurantId = typeof pageContext.restaurantId === 'string'
    ? pageContext.restaurantId.trim()
    : '';

  if (route && route !== '/restaurants' && !/^\/restaurants\/[a-fA-F0-9]{24}$/.test(route)) {
    return { error: 'pageContext route không được hỗ trợ.' };
  }

  if (restaurantId && !/^[a-fA-F0-9]{24}$/.test(restaurantId)) {
    return { error: 'pageContext restaurantId không hợp lệ.' };
  }

  return {
    pageContext: route || restaurantId ? {
      ...(route ? { route } : {}),
      ...(restaurantId ? { restaurantId } : {}),
    } : null,
  };
};

const validateOwnerContext = (ownerContext) => {
  if (ownerContext === undefined) return { ownerContext: null };

  if (!ownerContext || Array.isArray(ownerContext) || typeof ownerContext !== 'object') {
    return { error: 'ownerContext pháº£i lÃ  object.' };
  }

  const allowedKeys = new Set(['selectedRestaurantId']);
  for (const key of Object.keys(ownerContext)) {
    if (!allowedKeys.has(key)) {
      return { error: 'ownerContext chá»©a field khÃ´ng Ä‘Æ°á»£c há»— trá»£.' };
    }
  }

  const selectedRestaurantId = typeof ownerContext.selectedRestaurantId === 'string'
    ? ownerContext.selectedRestaurantId.trim()
    : '';

  if (selectedRestaurantId && !/^[a-fA-F0-9]{24}$/.test(selectedRestaurantId)) {
    return { error: 'ownerContext selectedRestaurantId khÃ´ng há»£p lá»‡.' };
  }

  return {
    ownerContext: {
      selectedRestaurantId: selectedRestaurantId || null,
    },
  };
};

const validateAdminContext = (adminContext) => {
  if (adminContext === undefined) return { adminContext: null };

  if (!adminContext || Array.isArray(adminContext) || typeof adminContext !== 'object') {
    return { error: 'adminContext phai la object.' };
  }

  const allowedKeys = new Set(['mode']);
  for (const key of Object.keys(adminContext)) {
    if (!allowedKeys.has(key)) {
      return { error: 'adminContext chua field khong duoc ho tro.' };
    }
  }

  const mode = typeof adminContext.mode === 'string' ? adminContext.mode.trim() : '';
  if (mode && mode !== 'admin_assistant') {
    return { error: 'adminContext mode khong duoc ho tro.' };
  }

  return {
    adminContext: {
      mode: 'admin_assistant',
    },
  };
};

const validateChatRequest = (body, config) => {
  const messageValidation = validateMessage(body, config.maxInputChars);
  if (messageValidation.error) return messageValidation;

  if (body.history !== undefined && !Array.isArray(body.history)) {
    return { error: 'history phải là một mảng.' };
  }

  const history = body.history || [];
  for (const item of history) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { error: 'Mỗi history item phải là object.' };
    }
    if (!['user', 'assistant'].includes(item.role)) {
      return { error: 'history role chỉ nhận user hoặc assistant.' };
    }
    if (typeof item.content !== 'string' || !item.content.trim()) {
      return { error: 'history content phải là chuỗi không rỗng.' };
    }
    if (item.content.trim().length > config.maxInputChars) {
      return { error: `history content không được vượt quá ${config.maxInputChars} ký tự.` };
    }
  }

  const pageContextValidation = validatePageContext(body.pageContext);
  if (pageContextValidation.error) return pageContextValidation;
  const ownerContextValidation = validateOwnerContext(body.ownerContext);
  if (ownerContextValidation.error) return ownerContextValidation;
  const adminContextValidation = validateAdminContext(body.adminContext);
  if (adminContextValidation.error) return adminContextValidation;

  return {
    message: messageValidation.message,
    history: (config.maxHistoryMessages === 0
      ? []
      : history.slice(-config.maxHistoryMessages))
      .map((item) => ({ role: item.role, content: item.content.trim() })),
    pageContext: pageContextValidation.pageContext,
    ownerContext: ownerContextValidation.ownerContext,
    adminContext: adminContextValidation.adminContext,
  };
};

const sendError = (res, status, code, message, requestId, details) => res.status(status).json({
  success: false,
  code,
  message,
  ...(details ? { details } : {}),
  requestId,
});

const createAiController = ({
  mockService = aiMockService,
  orchestrator = createAiOrchestrator(),
  configProvider = getAiConfig,
  observability = defaultAiObservabilityService,
  streamService = aiStreamService,
} = {}) => ({
  health(req, res) {
    let config;
    try {
      config = configProvider();
    } catch (error) {
      return res.json({
        success: true,
        data: {
          status: 'degraded',
          enabled: false,
          configured: false,
          provider: 'openai',
          primaryProvider: 'openai',
          fallbackProvider: 'groq',
          fallbackEnabled: false,
          openaiConfigured: false,
          groqConfigured: false,
          phase: 10,
          mockEnabled: isMockEnabled(),
          publicToolsEnabled: false,
          customerDynamicToolsEnabled: false,
          availabilityToolEnabled: false,
          voucherToolEnabled: false,
          bookingPreviewToolEnabled: false,
          bookingConfirmEnabled: false,
          knowledgeSearchEnabled: false,
          ownerToolsEnabled: false,
          adminToolsEnabled: false,
          budgets: { dailyEnabled: false, monthlyEnabled: false },
        },
        requestId: req.aiRequestId,
      });
    }

    const providerHealth = getProviderHealth(config);

    return res.json({
      success: true,
      data: {
        status: 'ok',
        enabled: config.enabled && providerHealth.configured,
        configured: providerHealth.configured,
        provider: providerHealth.primaryProvider,
        primaryProvider: providerHealth.primaryProvider,
        fallbackProvider: providerHealth.fallbackProvider,
        fallbackEnabled: providerHealth.fallbackEnabled,
        openaiConfigured: providerHealth.openaiConfigured,
        groqConfigured: providerHealth.groqConfigured,
        phase: 10,
        mockEnabled: isMockEnabled(),
        publicToolsEnabled: Boolean(config.publicToolsEnabled),
        customerDynamicToolsEnabled: Boolean(config.customerDynamicToolsEnabled),
        availabilityToolEnabled: Boolean(config.availabilityToolEnabled),
        voucherToolEnabled: Boolean(config.voucherToolEnabled),
        bookingPreviewToolEnabled: Boolean(config.bookingPreviewToolEnabled),
        bookingConfirmEnabled: Boolean(config.bookingConfirmEnabled),
        knowledgeSearchEnabled: Boolean(config.knowledgeSearchEnabled),
        ownerToolsEnabled: Boolean(config.ownerToolsEnabled),
        adminToolsEnabled: Boolean(config.adminToolsEnabled),
        toolTimeoutMs: config.toolTimeoutMs,
        maxToolRounds: config.maxToolRounds,
        maxToolCalls: config.maxToolCalls,
        budgets: {
          dailyEnabled: Number(config.dailyBudgetEstimate) > 0,
          monthlyEnabled: Number(config.monthlyBudgetEstimate) > 0,
        },
      },
      requestId: req.aiRequestId,
    });
  },

  metrics(req, res) {
    if (!req.user || req.user.role !== 'admin') {
      return sendError(
        res,
        req.user ? 403 : 401,
        req.user ? 'TOOL_NOT_ALLOWED' : 'AUTH_REQUIRED',
        'Can tai khoan admin de xem AI metrics.',
        req.aiRequestId,
      );
    }

    return res.json({
      success: true,
      data: observability.getSnapshot(),
      requestId: req.aiRequestId,
    });
  },

  async mockChat(req, res) {
    if (!isMockEnabled()) {
      return sendError(
        res,
        503,
        'AI_MOCK_DISABLED',
        'AI mock hiện đang tắt.',
        req.aiRequestId,
      );
    }

    const validation = validateMessage(req.body);
    if (validation.error) {
      return sendError(res, 400, 'INVALID_REQUEST', validation.error, req.aiRequestId);
    }

    try {
      const data = await mockService.createMockReply(validation.message);
      return res.json({ success: true, data, requestId: req.aiRequestId });
    } catch (error) {
      console.error(`[AI] requestId=${req.aiRequestId} code=AI_INTERNAL_ERROR`);
      return sendError(
        res,
        500,
        'AI_INTERNAL_ERROR',
        'Trợ lý BookEat đang tạm gián đoạn. Vui lòng thử lại.',
        req.aiRequestId,
      );
    }
  },

  async streamChat(req, res) {
    let config;
    try {
      config = configProvider();
    } catch (error) {
      console.error(`[AI] requestId=${req.aiRequestId} code=AI_CONFIG_ERROR field=${error.field || 'unknown'}`);
      return sendError(
        res,
        503,
        'AI_DISABLED',
        'Trợ lý BookEat chưa được cấu hình.',
        req.aiRequestId,
      );
    }

    const providerHealth = getProviderHealth(config);
    if (!config.enabled || !providerHealth.configured) {
      req.aiTelemetry = {
        ...(req.aiTelemetry || {}),
        mode: 'unavailable',
        status: 'failed',
        errorCode: 'AI_DISABLED',
      };
      return sendError(
        res,
        503,
        'AI_DISABLED',
        'Trợ lý BookEat hiện chưa sẵn sàng.',
        req.aiRequestId,
      );
    }

    const validation = validateChatRequest(req.body, config);
    if (validation.error) {
      return sendError(res, 400, 'INVALID_REQUEST', validation.error, req.aiRequestId);
    }

    const clientAbortController = new AbortController();
    let sequence = 0;
    let providerCompleted = false;
    let streamClosed = false;

    const handleClose = () => {
      streamClosed = true;
      if (!res.writableEnded) clientAbortController.abort(new Error('Client disconnected'));
    };
    res.once('close', handleClose);

    streamService.openSseStream(res);
    streamService.writeSseEvent(res, 'start', {
      requestId: req.aiRequestId,
      sequence: sequence++,
    });
    const effectiveAdminContext = req.user?.role === 'admin' ? validation.adminContext : null;
    const mode = effectiveAdminContext
      ? 'admin'
      : validation.ownerContext ? 'owner' : 'customer';
    const budgetState = observability.isBudgetExceeded(config);
    if (budgetState.exceeded) {
      req.aiTelemetry = {
        ...(req.aiTelemetry || {}),
        mode,
        status: 'failed',
        errorCode: 'BUDGET_LIMITED',
      };
      streamService.writeSseEvent(res, 'error', {
        requestId: req.aiRequestId,
        sequence: sequence++,
        code: 'BUDGET_LIMITED',
        message: 'Tro ly AI dang tam dung do vuot ngan sach van hanh.',
        retryable: false,
      });
      streamService.writeSseEvent(res, 'done', {
        requestId: req.aiRequestId,
        sequence: sequence++,
      });
      res.end();
      return undefined;
    }
    req.aiTelemetry = {
      ...(req.aiTelemetry || {}),
      mode,
      role: req.user?.role || 'guest',
      userId: req.user?._id || req.user?.id || null,
      providerUsed: null,
      fallbackReason: null,
      toolCount: 0,
      status: 'streaming',
      usage: { inputTokens: 0, outputTokens: 0 },
    };

    const writeAiEvent = (event) => {
      if (streamClosed) return;

      if (event.type === 'provider_status') {
        req.aiTelemetry.providerUsed = event.providerUsed || req.aiTelemetry.providerUsed || null;
        req.aiTelemetry.fallback = req.aiTelemetry.fallback || event.fallbackUsed === true;
        req.aiTelemetry.fallbackReason = event.fallbackReason || req.aiTelemetry.fallbackReason || null;
        if (event.fallbackUsed) {
          console.warn(`[AI] requestId=${req.aiRequestId} providerUsed=${event.providerUsed} fallbackReason=${event.fallbackReason || 'unknown'}`);
        }
      } else if (event.type === 'delta' && event.text) {
        streamService.writeSseEvent(res, 'delta', {
          requestId: req.aiRequestId,
          sequence: sequence++,
          text: event.text,
        });
      } else if (event.type === 'completed') {
        providerCompleted = true;
        req.aiTelemetry.usage = event.usage || { inputTokens: 0, outputTokens: 0 };
        streamService.writeSseEvent(res, 'completed', {
          requestId: req.aiRequestId,
          sequence: sequence++,
          usage: event.usage || { inputTokens: 0, outputTokens: 0 },
        });
      } else if (event.type === 'tool_started') {
        streamService.writeSseEvent(res, 'tool_started', {
          requestId: req.aiRequestId,
          sequence: sequence++,
          tool: event.tool,
          label: event.label,
        });
      } else if (event.type === 'tool_completed') {
        req.aiTelemetry.toolCount = (req.aiTelemetry.toolCount || 0) + 1;
        streamService.writeSseEvent(res, 'tool_completed', {
          requestId: req.aiRequestId,
          sequence: sequence++,
          tool: event.tool,
          label: event.label,
          status: event.status,
          latencyMs: event.latencyMs,
          errorCode: event.errorCode,
          message: event.message,
        });
      } else if (event.type === 'result') {
        streamService.writeSseEvent(res, 'result', {
          requestId: req.aiRequestId,
          sequence: sequence++,
          result: event.result,
        });
      }
    };

    try {
      for await (const event of orchestrator.streamChat({
        message: validation.message,
        history: validation.history,
        pageContext: validation.pageContext,
        ownerContext: validation.ownerContext,
        adminContext: effectiveAdminContext,
        requestId: req.aiRequestId,
        user: req.user || null,
        signal: clientAbortController.signal,
        config,
      })) {
        if (streamClosed) break;
        writeAiEvent(event);
      }

      if (!streamClosed && !providerCompleted) {
        streamService.writeSseEvent(res, 'completed', {
          requestId: req.aiRequestId,
          sequence: sequence++,
          usage: { inputTokens: 0, outputTokens: 0 },
        });
      }
    } catch (error) {
      const safeError = toPublicAiError(error);
      req.aiTelemetry = {
        ...(req.aiTelemetry || {}),
        status: 'failed',
        errorCode: safeError.code,
      };
      console.error(`[AI] requestId=${req.aiRequestId} code=${safeError.code}${getProviderCauseForLog(error)}`);

      const canUseMockFallback = sequence === 1
        && isStreamMockFallbackEnabled()
        && STREAM_MOCK_FALLBACK_CODES.has(safeError.code)
        && typeof mockService.streamMockChat === 'function';

      if (!streamClosed && canUseMockFallback) {
        req.aiTelemetry.fallback = true;
        req.aiTelemetry.fallbackReason = safeError.code;
        console.warn(`[AI] requestId=${req.aiRequestId} using mock public tool stream fallback`);
        try {
          for await (const fallbackEvent of mockService.streamMockChat({
            message: validation.message,
            pageContext: validation.pageContext,
            ownerContext: validation.ownerContext,
            adminContext: effectiveAdminContext,
            requestId: req.aiRequestId,
            user: req.user || null,
            signal: clientAbortController.signal,
          })) {
            if (streamClosed) break;
            writeAiEvent(fallbackEvent);
          }

          if (providerCompleted) return undefined;
        } catch (fallbackError) {
          console.error(`[AI] requestId=${req.aiRequestId} code=AI_MOCK_FALLBACK_FAILED message=${fallbackError.message}`);
        }
      }

      if (!streamClosed && safeError.code !== 'AI_CANCELLED') {
        streamService.writeSseEvent(res, 'error', {
          requestId: req.aiRequestId,
          sequence: sequence++,
          ...safeError,
        });
      }
    } finally {
      if (req.aiTelemetry && req.aiTelemetry.status === 'streaming') {
        req.aiTelemetry.status = streamClosed ? 'cancelled' : 'success';
      }
      res.removeListener('close', handleClose);
      if (!streamClosed) {
        streamService.writeSseEvent(res, 'done', {
          requestId: req.aiRequestId,
          sequence: sequence++,
        });
        res.end();
      }
    }

    return undefined;
  },
});

module.exports = {
  ...createAiController(),
  createAiController,
  sendError,
  validateChatRequest,
  validateAdminContext,
  validateMessage,
  validateOwnerContext,
  validatePageContext,
};
