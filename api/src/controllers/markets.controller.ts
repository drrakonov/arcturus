import type { Request, Response } from "express";
import { RedisManager } from "../managers/redisManager.js";
import { CREATE_MARKET } from "../types/status.js";


export const createMarket = async (req: Request, res: Response) => {
    try {
        const { baseAsset } = req.body;

        if (!baseAsset || typeof baseAsset !== "string") {
            return res.status(400).json({ success: false, message: "baseAsset is required" });
        }

        RedisManager.getInstance().sendFireAndForget({
            type: CREATE_MARKET,
            data: { baseAsset: baseAsset.toUpperCase() }
        });

        return res.status(201).json({
            success: true,
            payload: {
                market: `${baseAsset.toUpperCase()}_INR`,
                message: "Market creation dispatched to engine"
            }
        });
    } catch (err) {
        console.error("Failed to create market", err);
        return res.status(500).json({ success: false, message: "Failed to create market" });
    }
};
