import { Router } from 'express';
import { getTrades } from '../controllers/trades.controller.js';

const tradesRouter = Router();

tradesRouter.get("/", getTrades);

export default tradesRouter;