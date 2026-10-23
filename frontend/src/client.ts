export type { AccountSnapshot, MarketSnapshot } from '../../packages/contracts/src/index';
export interface Session { token: string; userId: string; expiresAt: number }
export interface PendingAction { path: string; method: string; body: unknown; key: string; createdAt: number; label: string }
export class ApiError extends Error {
  constructor(message: string, public code: string, public uncertain = false) { super(message); }
}
export const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
export const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';
export async function request<T>(path: string, token?: string, action?: { method: string; body?: unknown; key?: string; operatorKey?: string }): Promise<T> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 8000);
  try {
    const response = await fetch(`${apiUrl}${path}`, { method: action?.method || 'GET', signal: abort.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(action?.key ? { 'Idempotency-Key': action.key } : {}), ...(action?.operatorKey ? { 'X-Demo-Control-Token': action.operatorKey } : {}) },
      ...(action?.body !== undefined ? { body: JSON.stringify(action.body) } : {}) });
    const result = await response.json();
    if (!response.ok || !result.success) throw new ApiError(result.message || 'Request failed', result.code || 'REQUEST_FAILED', response.status >= 500);
    return result.payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('Connection interrupted. The order may have reached the engine. Retry the same request to confirm.', 'NETWORK_ERROR', true);
  } finally { clearTimeout(timeout); }
}
export function newer<T extends { generation: string; revision: number }>(current: T | null, next: T): T {
  return !current || current.generation !== next.generation || next.revision >= current.revision ? next : current;
}
