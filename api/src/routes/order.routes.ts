import express from 'express'
import { createOrder, deleteOrder, getOpenOrder } from '../controllers/order.controller.js';
import { getOrderHistory } from '../controllers/history.controller.js';
const orderRouter = express.Router();

orderRouter.post("/", createOrder)
orderRouter.delete("/", deleteOrder);
orderRouter.get("/open", getOpenOrder);
orderRouter.get("/history", getOrderHistory);

export default orderRouter