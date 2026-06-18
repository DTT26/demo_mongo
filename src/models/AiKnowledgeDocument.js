'use strict';

const mongoose = require('mongoose');

const ROLE_SCOPES = Object.freeze(['public', 'customer', 'owner', 'admin']);
const KNOWLEDGE_STATUSES = Object.freeze(['draft', 'published', 'archived']);
const KNOWLEDGE_CATEGORIES = Object.freeze(['policy', 'faq', 'guide', 'support', 'terms']);

const stripActiveMarkup = (value) => {
  if (typeof value !== 'string') return value;
  return value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\u0000/g, '')
    .trim();
};

const sourceSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      set: stripActiveMarkup,
    },
    url: {
      type: String,
      default: null,
      trim: true,
      maxlength: 500,
      set: stripActiveMarkup,
    },
    system: {
      type: String,
      default: 'bookeat',
      trim: true,
      maxlength: 80,
      set: stripActiveMarkup,
    },
  },
  { _id: false },
);

const aiKnowledgeDocumentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      set: stripActiveMarkup,
    },
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 120,
      match: /^[a-z0-9][a-z0-9-]{1,118}[a-z0-9]$/,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 160,
      match: /^[a-z0-9][a-z0-9-]{1,158}[a-z0-9]$/,
    },
    category: {
      type: String,
      required: true,
      enum: KNOWLEDGE_CATEGORIES,
      index: true,
    },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator(tags) {
          return Array.isArray(tags) && tags.length <= 30;
        },
        message: 'Knowledge document cannot have more than 30 tags.',
      },
      set: (tags) => (Array.isArray(tags)
        ? tags
          .map((tag) => stripActiveMarkup(String(tag || '')).toLowerCase())
          .filter(Boolean)
          .slice(0, 30)
        : []),
    },
    roleScope: {
      type: String,
      required: true,
      enum: ROLE_SCOPES,
      default: 'public',
      index: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20000,
      set: stripActiveMarkup,
    },
    summary: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1200,
      set: stripActiveMarkup,
    },
    source: {
      type: sourceSchema,
      required: true,
    },
    status: {
      type: String,
      enum: KNOWLEDGE_STATUSES,
      default: 'draft',
      required: true,
      index: true,
    },
    version: {
      type: Number,
      default: 1,
      min: 1,
      required: true,
    },
    effectiveFrom: {
      type: Date,
      default: null,
      index: true,
    },
    effectiveTo: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    minimize: false,
  },
);

aiKnowledgeDocumentSchema.index({ status: 1, roleScope: 1, category: 1, updatedAt: -1 });
aiKnowledgeDocumentSchema.index({ tags: 1, status: 1, roleScope: 1 });
aiKnowledgeDocumentSchema.index({ key: 1, status: 1 });
aiKnowledgeDocumentSchema.index({ slug: 1, status: 1 });

module.exports = mongoose.model('AiKnowledgeDocument', aiKnowledgeDocumentSchema);
module.exports.KNOWLEDGE_CATEGORIES = KNOWLEDGE_CATEGORIES;
module.exports.KNOWLEDGE_STATUSES = KNOWLEDGE_STATUSES;
module.exports.ROLE_SCOPES = ROLE_SCOPES;
module.exports.stripActiveMarkup = stripActiveMarkup;
