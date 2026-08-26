import { Router } from "express";
import { createMarket } from "../controllers/markets.controller.js";

const marketsRouter = Router();

marketsRouter.post("/", createMarket);

export default marketsRouter;
