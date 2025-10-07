import type { Request, Response } from "express";

export const getTrades = async (req: Request, res: Response) => {
    try {
        const { market } = req.query;

        //get from the db
    }catch(err) {
        console.log("Failed to get the trades", err);
        return res.status(500).json({ success: false, message: "Failed to get the trades" });
    }
}