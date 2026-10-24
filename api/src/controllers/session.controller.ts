import type { Request, Response, NextFunction } from "express";
import { TradingError } from "@arcturus/contracts";
import { RedisManager } from "../managers/redisManager.js";
import { commandError, engineResponse } from "./engine-response.js";

export async function requireSession(req: Request, res: Response, next: NextFunction) {
    try {
        const token = req.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
        const session = token ? await RedisManager.getInstance().getSession(token) : null;
        if (!session || session.expiresAt <= Date.now())
            throw new TradingError("UNAUTHORIZED", "Demo session expired or missing");
        res.locals.userId = session.userId;
        next();
    } catch (error) {
        commandError(res, error);
    }
}

export async function createSession(req: Request, res: Response) {
    try {
        const auth = req.get("Authorization");
        if (auth) {
            const token = auth.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
            const session = token ? await RedisManager.getInstance().getSession(token) : null;
            if (!session || session.expiresAt <= Date.now())
                throw new TradingError("UNAUTHORIZED", "Demo session expired");
            return res.json({ success: true, payload: { ...session, token } });
        }
        return res
            .status(201)
            .json({ success: true, payload: await RedisManager.getInstance().createSession() });
    } catch (error) {
        return commandError(res, error);
    }
}

export const getAccount = (_req: Request, res: Response) =>
    engineResponse(res, { type: "GET_ACCOUNT", data: { userId: res.locals.userId } });

export const getMarket = (req: Request, res: Response) =>
    engineResponse(res, { type: "GET_MARKET", data: { market: req.query.symbol } });
