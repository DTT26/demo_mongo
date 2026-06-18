'use strict';

const PUBLIC_TOOL_ROLES = Object.freeze([
  'guest',
  'customer',
  'restaurant_owner',
  'admin',
]);

class AiToolPermissionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AiToolPermissionError';
    this.code = code;
  }
}

const getActorContext = (user) => {
  if (!user) return { role: 'guest', userId: null };
  return {
    role: user.role || 'guest',
    userId: user._id || user.id || null,
  };
};

const assertToolAllowed = (tool, { user } = {}) => {
  if (!tool) {
    throw new AiToolPermissionError('TOOL_NOT_ALLOWED', 'Tool is not allowed.');
  }
  if (tool.exposedToModel === false || tool.effect === 'execute') {
    throw new AiToolPermissionError(
      'TOOL_NOT_ALLOWED',
      'Execute tools are not available to the AI model.',
    );
  }

  const actor = getActorContext(user);
  if (['customer', 'owner', 'admin'].includes(tool.access) && actor.role === 'guest') {
    throw new AiToolPermissionError('AUTH_REQUIRED', 'Login is required for this tool.');
  }

  if (!['public', 'customer', 'owner', 'admin'].includes(tool.access)) {
    throw new AiToolPermissionError('TOOL_NOT_ALLOWED', 'Tool is not allowed for customer AI.');
  }

  const allowedRoles = tool.allowedRoles || (
    tool.access === 'public'
      ? PUBLIC_TOOL_ROLES
      : tool.access === 'owner' ? ['restaurant_owner']
        : tool.access === 'admin' ? ['admin'] : ['customer']
  );
  if (!allowedRoles.includes(actor.role)) {
    throw new AiToolPermissionError('TOOL_NOT_ALLOWED', 'Role is not allowed for this tool.');
  }

  return actor;
};

module.exports = {
  AiToolPermissionError,
  PUBLIC_TOOL_ROLES,
  assertToolAllowed,
  getActorContext,
};
