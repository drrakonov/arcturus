import type { Request, Response } from 'express'
import { RedisManager } from '../managers/redisManager.js';
import { GET_DEPTH } from '../types/status.js';

export const getDepth = async (req: Request, res: Response) => {
    try {
        const { symbol } = req.query;
        const result = await RedisManager.getInstance().sendAndAwait({
            type: GET_DEPTH,
            data: {
                market: symbol as string
            }
        });
        
        return res.status(200).json({ success: true, payload: result.payload });

    } catch (err) {
        console.log("Failed to get the depths", err);
        return res.status(500).json({ success: false, message: "Failed to get the depths" })
    }
}