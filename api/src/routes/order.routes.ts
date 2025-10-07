import express from 'express'
import { createOrder, deleteOrder, getOpenOrder } from '../controllers/order.controller.js';
const orderRouter = express.Router();

orderRouter.post("/", createOrder)
orderRouter.delete("/", deleteOrder);
orderRouter.get("/open", getOpenOrder);

export default orderRouter