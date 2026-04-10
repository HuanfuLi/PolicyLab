/**
 * Branded type for session-scoped database queries.
 *
 * Forces callers to explicitly create a scope, making it impossible to
 * accidentally pass an unvalidated string as a session ID in queries.
 */
declare const SessionBrand: unique symbol;

/** A validated session ID that can be used in session-scoped queries. */
export type SessionScope = string & { readonly [SessionBrand]: true };

/** Create a SessionScope from a validated session ID string. */
export function createScope(sessionId: string): SessionScope {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('Invalid sessionId for SessionScope');
  }
  return sessionId as SessionScope;
}

/**
 * Type guard: check if a value is a SessionScope.
 * Useful in route handlers that receive params from Express.
 */
export function isSessionScope(value: unknown): value is SessionScope {
  return typeof value === 'string' && value.length > 0;
}
