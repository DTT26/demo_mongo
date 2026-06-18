'use strict';

const { sendError } = require('./ai.controller');
const { createAiToolRegistry } = require('../services/ai/ai-tool-registry');
const { createAiToolRunner } = require('../services/ai/ai-tool-runner');

const ALLOWED_CATEGORIES = new Set(['policy', 'faq', 'guide', 'support', 'terms']);

const parseLimit = (value) => {
  if (value === undefined || value === null || value === '') return 3;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 5) return null;
  return number;
};

const createAiKnowledgeController = ({
  registry = createAiToolRegistry(),
  toolRunner = createAiToolRunner({ registry }),
} = {}) => ({
  async search(req, res) {
    const query = typeof req.query.query === 'string'
      ? req.query.query.trim()
      : String(req.query.q || '').trim();
    const category = typeof req.query.category === 'string' && req.query.category.trim()
      ? req.query.category.trim()
      : null;
    const limit = parseLimit(req.query.limit);

    if (!query || query.length > 240) {
      return sendError(
        res,
        400,
        'INVALID_REQUEST',
        'query phải là chuỗi từ 1 đến 240 ký tự.',
        req.aiRequestId,
      );
    }

    if (category && !ALLOWED_CATEGORIES.has(category)) {
      return sendError(
        res,
        400,
        'INVALID_REQUEST',
        'category không được hỗ trợ.',
        req.aiRequestId,
      );
    }

    if (limit === null) {
      return sendError(
        res,
        400,
        'INVALID_REQUEST',
        'limit phải là số nguyên từ 1 đến 5.',
        req.aiRequestId,
      );
    }

    const toolResult = await toolRunner.runToolCall({
      toolName: 'search_knowledge',
      rawArguments: { query, category, limit },
      requestId: req.aiRequestId,
      user: req.user || null,
      signal: req.signal,
    });

    if (!toolResult.ok && !toolResult.result) {
      const status = toolResult.status === 'forbidden' ? 403 : 400;
      return sendError(
        res,
        status,
        toolResult.errorCode || 'KNOWLEDGE_SEARCH_FAILED',
        toolResult.message || 'Không thể tìm knowledge.',
        req.aiRequestId,
      );
    }

    return res.json({
      success: true,
      data: toolResult.result?.payload || null,
      requestId: req.aiRequestId,
    });
  },
});

module.exports = {
  ...createAiKnowledgeController(),
  createAiKnowledgeController,
};
