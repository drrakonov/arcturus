import { z } from 'zod';

export const createOrderSchema = z.object({
    market: z.string(),
    price: z.string(),
    quantity: z.string(),
    side: z.enum(["buy", "sell"]),
    userId: z.string()
})

export const deleteOrderSchema = z.object({
    market: z.string(),
    orderId: z.string()
})