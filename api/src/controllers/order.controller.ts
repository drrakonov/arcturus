import { TradingError } from "@arcturus/contracts";
import type { Request, Response } from "express";
import { createOrderSchema, deleteOrderSchema } from "../types/zodType.js";
import { commandError, engineResponse } from "./engine-response.js";

export const createOrder = async (req: Request, res: Response) => {
    try {
        if (req.body?.orderType !== undefined && !["limit", "market"].includes(req.body.orderType))
            throw new TradingError("INVALID_REQUEST", "Unknown order type");
        if (req.body?.orderType === "market")
            return await engineResponse(
                res,
                {
                    type: "MARKET_ORDER",
                    data: {
                        market: req.body.market,
                        protectionPrice: req.body.protectionPrice,
                        quantity: req.body.quantity,
                        side: req.body.side,
                        userId: res.locals.userId
                    }
                },
                200,
                requestId(req)
            );
        return await engineResponse(
            res,
            {
                type: "CREATE_ORDER",
                data: createOrderSchema.parse({ ...req.body, userId: res.locals.userId })
            },
            200,
            requestId(req)
        );
    } catch (error) {
        return commandError(res, error);
    }
};

export const deleteOrder = async (req: Request, res: Response) => {
    try {
        return await engineResponse(
            res,
            {
                type: "CANCEL_ORDER",
                data: { ...deleteOrderSchema.parse(req.body), userId: res.locals.userId }
            },
            200,
            requestId(req)
        );
    } catch (error) {
        return commandError(res, error);
    }
};

export const getOpenOrder = async (req: Request, res: Response) =>
    engineResponse(res, {
        type: "GET_OPEN_ORDERS",
        data: { userId: res.locals.userId, market: req.query.market }
    });

export function requestId(req: Request): string {
    const id = req.get("Idempotency-Key");
    if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id))
        throw new TradingError(
            "INVALID_REQUEST",
            "Idempotency-Key header required (8–64 letters, digits or hyphens)"
        );
    return id;
}
