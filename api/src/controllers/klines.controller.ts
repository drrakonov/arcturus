import type { Request, Response } from "express";

export const getKlines = async (req: Request, res: Response) => {
    try {
        
    }catch(err) {
        console.log("Failed to get the klines", err);
        return res.status(500).json({ success: false, message: "Failed to get the klines" })
    }
}