import type { Request, Response } from 'express';
import { engineResponse } from './engine-response.js';
export const getDepth = async (req: Request, res: Response) =>
    engineResponse(res, { type: 'GET_DEPTH', data: { market: req.query.symbol } });
