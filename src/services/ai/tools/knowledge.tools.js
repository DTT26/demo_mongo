'use strict';

const aiKnowledgeService = require('../ai-knowledge.service');

const asStringOrNull = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const createKnowledgeTools = ({
  knowledgeService = aiKnowledgeService,
} = {}) => ({
  async search_knowledge(args = {}, context = {}) {
    return knowledgeService.searchKnowledge({
      query: asStringOrNull(args.query),
      category: asStringOrNull(args.category),
      limit: Number.isInteger(args.limit) ? args.limit : null,
      actorRole: context.actor?.role || context.user?.role || 'guest',
    });
  },
});

module.exports = {
  createKnowledgeTools,
};
