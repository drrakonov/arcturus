import type { Request, Response } from "express";

export const getTickers = async (req: Request, res: Response) => {
    try {
        
    }catch(err) {
        console.log("Failed to get the tickers", err);;
        return res.status(500).json({ success: false, message: "Failed to get the tickers" });
    }
}