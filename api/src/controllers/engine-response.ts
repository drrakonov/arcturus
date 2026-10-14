import type { Response } from 'express';
import { TradingError, validateMessage } from '@arcturus/contracts';
import type { ErrorCode } from '@arcturus/contracts';
import { ZodError } from 'zod';
import { RedisManager } from '../managers/redisManager.js';

const status: Record<ErrorCode, number> = {
    UNAUTHORIZED: 401, FORBIDDEN: 403, REQUEST_CONFLICT: 409, REQUEST_TIMEOUT: 504, SERVICE_UNAVAILABLE: 503,
    INVALID_REQUEST: 400, UNKNOWN_MARKET: 404, UNKNOWN_USER: 404, ORDER_NOT_FOUND: 404,
    INSUFFICIENT_FUNDS: 422, LIMIT_EXCEEDED: 409, DUPLICATE_TRANSACTION: 409, INTERNAL_ERROR: 500,
};
export async function engineResponse(res: Response, command: unknown, successStatus = 200, requestId?: string) {
    try {
        const result = await RedisManager.getInstance().sendAndAwait(validateMessage(command), requestId);
        if (result.type === 'ERROR') return res.status(status[result.payload.code]).json({ success: false, ...result.payload });
        return res.status(successStatus).json({ success: true, payload: result.payload });
    } catch (error) { return commandError(res, error); }
}
export function commandError(res: Response, error: unknown) {
    if (error instanceof TradingError) return res.status(status[error.code]).json({ success: false, code: error.code, message: error.message });
    if (error instanceof ZodError) return res.status(400).json({ success: false, code: 'INVALID_REQUEST', message: 'Invalid command fields' });
    console.error('Trading request failed', error);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Trading request failed' });
}
