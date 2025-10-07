import { Router } from 'express';
import { getDepth } from '../controllers/depth.controller.js';

const depthRouter = Router();

depthRouter.get("/", getDepth);

export default depthRouter