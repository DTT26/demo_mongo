'use strict';

const OpenAI = require('openai');

const PUBLIC_ERRORS = {
  AI_AUTH_ERROR: {
    message: 'Cấu hình Trợ lý BookEat chưa hợp lệ.',
    retryable: false,
  },
  AI_RATE_LIMITED: {
    message: 'Trợ lý đang nhận quá nhiều yêu cầu. Vui lòng thử lại sau.',
    retryable: true,
  },
  AI_TIMEOUT: {
    message: 'Trợ lý phản hồi quá lâu. Vui lòng thử lại.',
    retryable: true,
  },
  AI_UNAVAILABLE: {
    message: 'Trợ lý đang tạm gián đoạn.',
    retryable: true,
  },
  AI_CANCELLED: {
    message: 'Phản hồi đã được dừng.',
    retryable: true,
  },
};

class AiProviderError extends Error {
  constructor(code, options = {}) {
    const publicError = PUBLIC_ERRORS[code] || PUBLIC_ERRORS.AI_UNAVAILABLE;
    super(publicError.message);
    this.name = 'AiProviderError';
    this.code = code in PUBLIC_ERRORS ? code : 'AI_UNAVAILABLE';
    this.retryable = options.retryable ?? publicError.retryable;
    this.cause = options.cause;
  }
}

const mapProviderError = (error) => {
  if (error instanceof AiProviderError) return error;

  const status = Number(error?.status);
  if (status === 401 || status === 403) {
    return new AiProviderError('AI_AUTH_ERROR', { cause: error });
  }
  if (status === 429) {
    return new AiProviderError('AI_RATE_LIMITED', { cause: error });
  }
  if (
    error?.name === 'AbortError'
    || error?.name === 'APIConnectionTimeoutError'
    || status === 408
  ) {
    return new AiProviderError('AI_TIMEOUT', { cause: error });
  }

  return new AiProviderError('AI_UNAVAILABLE', { cause: error });
};

const mapStreamEventError = (event) => {
  const errorCode = event?.code || event?.response?.error?.code;
  if (errorCode === 'rate_limit_exceeded') {
    return new AiProviderError('AI_RATE_LIMITED');
  }
  return new AiProviderError('AI_UNAVAILABLE');
};

const normalizeUsage = (usage) => ({
  inputTokens: Number(usage?.input_tokens) || 0,
  outputTokens: Number(usage?.output_tokens) || 0,
});

const normalizeFunctionCall = (item) => ({
  id: item.id || null,
  callId: item.call_id,
  name: item.name,
  arguments: item.arguments || '{}',
  type: 'function_call',
});

const createOpenAiProvider = ({ clientFactory } = {}) => ({
  async *streamText({
    instructions,
    input,
    config,
    signal,
    tools = [],
    maxToolCalls,
  }) {
    const createClient = clientFactory || ((apiKey) => new OpenAI({
      apiKey,
      maxRetries: 0,
      timeout: config.timeoutMs,
    }));

    let stream;
    try {
      const client = createClient(config.apiKey);
      const body = {
        model: config.model,
        instructions,
        input,
        max_output_tokens: config.maxOutputTokens,
        store: false,
        stream: true,
      };

      if (Array.isArray(tools) && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = 'auto';
        body.parallel_tool_calls = false;
        if (Number.isInteger(maxToolCalls)) body.max_tool_calls = maxToolCalls;
      }

      stream = await client.responses.create(body, {
        signal,
        timeout: config.timeoutMs,
        maxRetries: 0,
      });
    } catch (error) {
      throw mapProviderError(error);
    }

    try {
      const yieldedToolCalls = new Set();
      for await (const event of stream) {
        if (event.type === 'response.output_text.delta' && event.delta) {
          yield { type: 'delta', text: event.delta };
        } else if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
          const call = normalizeFunctionCall(event.item);
          if (call.callId && !yieldedToolCalls.has(call.callId)) {
            yieldedToolCalls.add(call.callId);
            yield { type: 'function_call', call };
          }
        } else if (event.type === 'response.completed') {
          for (const item of event.response?.output || []) {
            if (item?.type === 'function_call') {
              const call = normalizeFunctionCall(item);
              if (call.callId && !yieldedToolCalls.has(call.callId)) {
                yieldedToolCalls.add(call.callId);
                yield { type: 'function_call', call };
              }
            }
          }
          yield { type: 'completed', usage: normalizeUsage(event.response?.usage) };
        } else if (
          event.type === 'error'
          || event.type === 'response.failed'
          || event.type === 'response.incomplete'
        ) {
          throw mapStreamEventError(event);
        }
      }
    } catch (error) {
      throw mapProviderError(error);
    }
  },
});

const toPublicAiError = (error) => {
  const mappedError = mapProviderError(error);
  return {
    code: mappedError.code,
    message: mappedError.message,
    retryable: mappedError.retryable,
  };
};

module.exports = {
  AiProviderError,
  createOpenAiProvider,
  mapProviderError,
  normalizeFunctionCall,
  toPublicAiError,
};
