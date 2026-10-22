import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { TradingError } from '@arcturus/contracts';
import { RedisManager } from '../managers/redisManager.js';
import { commandError, engineResponse } from './engine-response.js';
import { requestId } from './order.controller.js';

function operator(req: Request) {
    const expected = process.env.DEMO_CONTROL_TOKEN ?? '', supplied = req.get('X-Demo-Control-Token') ?? '';
    if (expected.length < 16 || Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
        !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) throw new TradingError('FORBIDDEN','Demo controls require the operator key');
}
export async function telemetry(_req: Request, res: Response) {
    try { return res.json({ success:true,payload:await RedisManager.getInstance().telemetry(res.locals.userId) }); }
    catch(error) { return commandError(res,error); }
}
export async function scenario(req: Request, res: Response) {
    try {
        operator(req);
        return await engineResponse(res,{type:'RUN_SCENARIO',data:{userId:res.locals.userId,scenario:req.body?.scenario}},200,requestId(req));
    } catch(error) { return commandError(res,error); }
}
export async function pause(req: Request, res: Response) {
    try {
        operator(req);
        const seconds=req.body?.seconds;
        if (!Number.isInteger(seconds) || seconds<0 || seconds>15) throw new TradingError('INVALID_REQUEST','Pause must be 0–15 seconds');
        await RedisManager.getInstance().pause(seconds);
        return res.json({success:true,payload:{seconds}});
    } catch(error) { return commandError(res,error); }
}
