import type { Request, Response } from 'express';
import { createOrderSchema, deleteOrderSchema } from '../types/zodType.js';
import { commandError, engineResponse } from './engine-response.js';

export const createOrder = async (req: Request, res: Response) => {
    try { return await engineResponse(res, { type: 'CREATE_ORDER', data: createOrderSchema.parse(req.body) }); }
    catch (error) { return commandError(res, error); }
};
export const deleteOrder = async (req: Request, res: Response) => {
    try { return await engineResponse(res, { type: 'CANCEL_ORDER', data: deleteOrderSchema.parse(req.body) }); }
    catch (error) { return commandError(res, error); }
};
export const getOpenOrder = async (req: Request, res: Response) =>
    engineResponse(res, { type: 'GET_OPEN_ORDERS', data: { userId: req.query.userId, market: req.query.market } });
