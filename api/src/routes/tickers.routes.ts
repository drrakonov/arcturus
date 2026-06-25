import { Router } from "express";
import { getTickers } from "../controllers/tickers.controller.js";

const tickersRouter = Router();

tickersRouter.get("/", getTickers);

export default tickersRouter;