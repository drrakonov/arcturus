import type { Request, Response } from 'express';
import { engineResponse } from './engine-response.js';
export const createMarket = async (req: Request, res: Response) =>
    engineResponse(res, { type: 'CREATE_MARKET', data: { baseAsset: req.body?.baseAsset } }, 201);
