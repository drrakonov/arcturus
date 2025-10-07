import { Router } from 'express';
import { getKlines } from '../controllers/klines.controller.js';

const klinesRouter = Router();

klinesRouter.get("/", getKlines)


export default klinesRouter;