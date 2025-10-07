import { RedisManager } from "../managers/redisManager.js";
import { CANCEL_ORDER, CREATE_ORDER, GET_OPEN_ORDERS } from "../types/status.js";
import { createOrderSchema, deleteOrderSchema } from "../types/zodType.js";
import type { Request, Response } from 'express'


export const createOrder = async (req: Request, res: Response) => {
    try {
        const {
            market,
            price,
            quantity,
            side,
            userId
        } = createOrderSchema.parse(req.body);

        console.log({ market, price, quantity, side, userId });

        const response = await RedisManager.getInstance().sendAndAwait({
            type: CREATE_ORDER,
            data: {
                market,
                price,
                quantity,
                side,
                userId
            }
        });
        return res.status(200).json({ success: true, payload: response.payload });
    } catch (err) {
        console.log("Order creation failed", err);
        return res.status(500).json({ success: false, message: "Failed to create order" });
    }
}


export const deleteOrder = async (req: Request, res: Response) => {
    try {
        const { orderId, market } = deleteOrderSchema.parse(req.body);

        const result = await RedisManager.getInstance().sendAndAwait({
            type: CANCEL_ORDER,
            data: {
                orderId,
                market
            }
        });

        return res.status(200).json({ success: true, payload: result.payload })
    } catch (err) {
        console.log("Order cancelling failed", err);
        return res.status(500).json({ success: false, message: "Failed to cancel order" });
    }

}

export const getOpenOrder = async (req: Request, res: Response) => {
    try {
        const result = await RedisManager.getInstance().sendAndAwait({
            type: GET_OPEN_ORDERS,
            data: {
                userId: req.query.userId as string,
                market: req.query.market as string
            }
        });

        return res.status(200).json({ success: true, payload: result.payload })
    }catch(err) {
        console.log("Failed to get open order", err);
        return res.status(500).json({ success: false, message: "Failed to get open order" })
    }
}