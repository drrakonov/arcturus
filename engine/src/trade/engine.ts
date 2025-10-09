import fs from 'fs';
import { Orderbook, type Fill, type Order } from "./orderbook.js";
import { RedisManager } from '../redisManager.js';
import { ORDER_UPDATE, TRADE_ADDED } from '../types/types.js';
import { CANCEL_ORDER, CREATE_ORDER, GET_DEPTH, GET_OPEN_ORDER, ON_RAMP, type MessageFromApi } from '../types/fromApi.js';

export const BASE_CURRENCY = "INR";

interface UserBalance {
    [key: string]: {
        available: number;
        locked: number;
    }
}

export class Engine {
    private orderbooks: Orderbook[] = [];
    private balances: Map<string, UserBalance> = new Map();

    constructor() {
        let snapshot = null;
        try {
            if (process.env.WITH_SNAPSHOT) {
                snapshot = fs.readFileSync("./snapshot.json");
            }
        } catch (err) {
            console.log("No snapshot found");
        }

        if (snapshot) {
            const snapshotSnapshot = JSON.parse(snapshot.toString());
            this.orderbooks = snapshotSnapshot.orderbooks.map((o: any) => new Orderbook(
                o.baseAsset,
                o.bids,
                o.asks,
                o.lastTradeId,
                o.currentPrice
            ));
            this.balances = new Map(snapshotSnapshot.balances);
        } else {
            this.orderbooks = [new Orderbook(`TATA`, [], [], 0, 0)];
            this.setBaseBalances();
        }

        setInterval(() => {
            this.saveSnapshot();
        }, 1000 * 3)

    }

    //it saves the instance of all orderbooks in the snapshot.json
    saveSnapshot() {
        const snapshotSnapshot = {
            orderbooks: this.orderbooks.map(o => o.getSnapshot()),
            balances: Array.from(this.balances.entries())
        }
        fs.writeFileSync("./snapshot.json", JSON.stringify(snapshotSnapshot));
    }

    process({ message, clientId }: {message: MessageFromApi, clientId: string}) {
        switch(message.type) {
            case CREATE_ORDER:
                try {
                    const { executedQty, fills, orderId } = this.createOrder(message.data.market, message.data.price, message.data.quantity, message.data.side, message.data.userId);
                    RedisManager.getInstance().sendToApi(clientId, {
                        type: "ORDER_PLACED",
                        payload: {
                            orderId,
                            executedQty,
                            fills
                        }
                    });
                }catch(err) {
                    console.log("Failed to create order", err);
                    RedisManager.getInstance().sendToApi(clientId, {
                        type: "ORDER_CANCELLED",
                        payload: {
                            orderId: "",
                            executedQty: 0,
                            remainingQty: 0
                        }
                    });
                }
                break;
            case CANCEL_ORDER:
                try {
                    const orderId = message.data.orderId;
                    const cancelMarket = message.data.market;
                    const cancelOrderbook = this.orderbooks.find(orderbook => orderbook.ticker() === cancelMarket);
                    const quoteAsset = cancelMarket.split("_")[1];
                    if(!cancelOrderbook) {
                        throw new Error("Orderbook not found");
                    } 

                    const order = cancelOrderbook.asks.find(ask => ask.orderId === orderId) || cancelOrderbook.bids.find(bid => bid.orderId === orderId);
                    if(!order) {
                        console.log("No order found");
                        throw new Error("No Order found");
                    }

                    const userBalance = this.balances.get(order.userId);
                    if(!userBalance) throw new Error("User not found");                

                    if(order.side === "buy") {
                        const price = cancelOrderbook.cancelBid(order);
                        const leftQuantity = (order.quantity - order.filled) * order.price;

                        userBalance[BASE_CURRENCY].available += leftQuantity;
                        userBalance[BASE_CURRENCY].locked -= leftQuantity;
                        if(price) {
                            this.sendUpdatedDepthAt(price.toString(), cancelMarket);
                        }
                    }else {
                        const price = cancelOrderbook.cancelAsk(order);
                        const leftQuantity = (order.quantity - order.filled);

                        userBalance[quoteAsset].available += leftQuantity;
                        userBalance[quoteAsset].locked -= leftQuantity;

                        if(price) {
                            this.sendUpdatedDepthAt(price.toString(), cancelMarket);
                        }
                    }

                    RedisManager.getInstance().sendToApi(clientId, {
                        type: "ORDER_CANCELLED",
                        payload: {
                            orderId,
                            executedQty: 0,
                            remainingQty: 0
                        }
                    })
                }catch(err) {
                    console.log("Error while cancelling order", err);
                }
                break;
            case GET_OPEN_ORDER:
                try {
                    const openOrderbook = this.orderbooks.find(o => o.ticker() === message.data.market);
                    if(!openOrderbook) {
                        throw new Error("No orderbook found");
                    }

                    const openOrders = openOrderbook.getOpenOrders(message.data.userId);
                    
                    RedisManager.getInstance().sendToApi(clientId, {
                        type: "OPEN_ORDERS",
                        payload: openOrders
                    });
                }catch(err) {
                    console.log("Failed to get the open orders", err);
                }
                break;
            case ON_RAMP:
                const userId = message.data.userId;
                const txnId = message.data.txnId;
                const amount = Number(message.data.amount);
                this.onRamp(userId, amount);
                break;
            case GET_DEPTH:
                try {
                    const market = message.data.market;
                    const orderbook = this.orderbooks.find(o => o.ticker() === market);
                    if(!orderbook) {
                        throw new Error("Orderbook not found");
                    }
                    RedisManager.getInstance().sendToApi(clientId, {
                        type: "DEPTH",
                        payload: orderbook.getDepth()
                    })
                }catch(err) {
                    console.log("Failed to find the depths", err);
                    RedisManager.getInstance().sendToApi(clientId, {
                        type: "DEPTH",
                        payload: {
                            bids: [],
                            asks: []
                        }
                    })
                }
                break;
        }
    }

    //add orer book to orderbooks
    addOrderbook(orderbook: Orderbook) {
        this.orderbooks.push(orderbook);
    }

    createOrder(market: string, price: string, quantity: string, side: "buy" | "sell", userId: string) {
        const orderbook = this.orderbooks.find(o => o.ticker() === market)
        const baseAsset = market.split("_")[0];
        const quoteAsset = market.split("_")[1];

        if(!orderbook) {
            throw new Error("No orderbook found");
        }

        this.checkAndLockFunds(baseAsset, quoteAsset, side, userId, quoteAsset, price, quantity);

        const order: Order = {
            price: Number(price),
            quantity: Number(quantity),
            orderId: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
            side: side,
            userId: userId,
            filled: 0 
        };

        const { fills, executedQty } = orderbook.addOrder(order);

        this.updateBalance(userId, baseAsset, quoteAsset, side, executedQty, fills);
        this.createDbTrades(fills, userId, market);
        this.updateDbOrders(order, executedQty, fills, market);
        this.publishWsDepthUpdates(market, side, fills, price);
        this.publishWsTrades(fills, userId, market);

        return {
            executedQty,
            fills,
            orderId: order.orderId
        }

    }

    updateDbOrders(order: Order, executedQty: number, fills: Fill[], market: string) {
        RedisManager.getInstance().pushMessage({
            type: ORDER_UPDATE,
            data: {
                orderId: order.orderId,
                executedQty: executedQty,
                market: market,
                price: order.price.toString(),
                quantity: order.quantity.toString(),
                side: order.side
            }
        });

        fills.forEach(fill => {
            RedisManager.getInstance().pushMessage({
                type: ORDER_UPDATE,
                data: {
                    orderId: order.orderId,
                    executedQty: executedQty,
                }
            });
        })
    }

    createDbTrades(fills: Fill[], userId: string, market: string) {
        fills.map(fill => {
            RedisManager.getInstance().pushMessage({
                type: TRADE_ADDED,
                data: {
                    id: userId,
                    isBuyerMaker: fill.otherUserId === userId,
                    price: fill.price,
                    quantity: fill.qty.toString(),
                    quoteQuantity: (fill.qty * Number(fill.price)).toString(),
                    market: market,
                    timestamp: Date.now()
                }
            })
        })
    }

    publishWsTrades(fills: Fill[],userId: string, market: string) {
        fills.map(fill => {
            RedisManager.getInstance().publishMessage(`trade@${market}`, {
                stream: `trade@${market}`,
                data: {
                    e: "trade",
                    t: fill.tradeId,
                    m: fill.otherUserId === userId,
                    p: fill.price,
                    q: fill.qty.toString(),
                    s: market
                }
            });
        })
    }

    sendUpdatedDepthAt(price: string, market: string) {
        const orderbook = this.orderbooks.find(o => o.ticker() === market);
        if(!orderbook) return;

        const depth = orderbook.getDepth();
        const updateAsks = depth.asks.filter(x => x[0] === price);
        const updateBids = depth.bids.filter(x => x[0] === price);

        RedisManager.getInstance().publishMessage(`depth@${market}`, {
            stream: `depth@${market}`,
            data: {
                a: updateAsks.length ? updateAsks : [[price, "0"]],
                b: updateBids.length ? updateBids : [[price, "0"]],
                e: "depth"
            }
        });
    }


    publishWsDepthUpdates(market: string, side: "buy" | "sell", fills: Fill[], price: string) {
        const orderbook = this.orderbooks.find(o => o.ticker() === market);
        if(!orderbook) {
            return;
        }

        const depth = orderbook.getDepth();
        if(side === "buy") {
            const updateAsks = depth.asks.filter(x => fills.map(f => f.price).includes(x[0].toString()));
            const updateBids = depth.bids.filter(x => x[0] === price);
            console.log("publish ws depth updates");

            RedisManager.getInstance().publishMessage(`depth@${market}`, {
                stream: `depth@${market}`,
                data: {
                    a: updateAsks,
                    b: updateBids? updateBids : [],
                    e: "depth"
                }
            });
        }else {
            const updateAsks = depth.asks.filter(x => fills.map(f => f.price).includes(x[0].toString()));
            const updateBids = depth.bids.filter(x => x[0] === price);
            console.log("publish ws depth updates");

            RedisManager.getInstance().publishMessage(`depth@${market}`, {
                stream: `depth@${market}`,
                data: {
                    a: updateAsks? updateAsks : [],
                    b: updateBids,
                    e: "depth"
                }
            });
        }
    }



    updateBalance(userId: string, baseAsset: string, quoteAsset: string, side: "buy" | "sell", executedQty: number, fills: Fill[]) {
        const userBalance = this.balances.get(userId);
        
        if(!userBalance) throw new Error("User not found");

        if(side === "buy") {
            fills.forEach(fill => {
                const otherUserBalance = this.balances.get(fill.otherUserId);
                if(!otherUserBalance) throw new Error("Other user is not found");

                //update baseAssets
                otherUserBalance[baseAsset].locked -= fill.qty;
                userBalance[baseAsset].available += fill.qty;
                
                //update quoteAsset
                const totalCost = fill.qty * Number(fill.price);
                otherUserBalance[quoteAsset].available += totalCost;
                userBalance[quoteAsset].locked -= totalCost;

            })
        }else {
            fills.forEach(fill => {
                const otherUserBalance = this.balances.get(fill.otherUserId);
                if(!otherUserBalance) throw new Error("Other user not found");

                //update baseAsset
                userBalance[baseAsset].locked -= fill.qty;
                otherUserBalance[baseAsset].available += fill.qty;

                //update quoteAsset
                const totalCost = fill.qty * Number(fill.price);
                userBalance[quoteAsset].available += totalCost;
                otherUserBalance[quoteAsset].locked -= totalCost;

            })
        }
    }



    //it checks for the available funds and if they are sufficient
    //it locks that much funds for a specific order["buy" | "sell"].
    checkAndLockFunds(
        baseAsset: string,
        quoteAsset: string,
        side: "buy" | "sell",
        userId: string,
        asset: string,
        price: string,
        quantity: string
    ) {
        const userBalance = this.balances.get(userId);
        const qty = Number(quantity);
        const prc = Number(price);

        if(qty < 0 || prc < 0) {
            throw new Error("Invalid quantity or price");
        }

        if(side === "buy") {

            if(!userBalance || !userBalance[quoteAsset]) {
                throw new Error("User or asset not found");
            }

            const totalCost = qty * prc;

            if(userBalance[quoteAsset].available < totalCost) {
                throw new Error("Insufficient funds");
            }

            userBalance[quoteAsset].available -= totalCost;
            userBalance[quoteAsset].locked += totalCost
            
        }else {

            if(!userBalance || !userBalance[baseAsset]) {
                throw new Error("User or asset not found");
            }

            if(userBalance[baseAsset].available < qty) {
                throw new Error("Insufficient funds");
            }

            userBalance[baseAsset].available -= qty;
            userBalance[baseAsset].locked += qty;

        }
    }


    //It adds the funds to the existing user or creates one
    onRamp(userId: string, amount: number) {
        const userBalance = this.balances.get(userId);
        if(!userBalance) {
            this.balances.set(userId, {
                [BASE_CURRENCY]: {
                    available: amount,
                    locked: 0
                }
            });
        } else {
            userBalance[BASE_CURRENCY].available += amount;
        }
    }

    //it sets the Base/Initial funds for users
    setBaseBalances() {
        this.balances.set("1", {
            [BASE_CURRENCY]: {
                available: 10000000,
                locked: 0
            },
            "TATA": {
                available: 10000000,
                locked: 0
            }
        });
        this.balances.set("2", {
            [BASE_CURRENCY]: {
                available: 10000000,
                locked: 0
            },
            "TATA": {
                available: 10000000,
                locked: 0
            }
        });
        this.balances.set("5", {
            [BASE_CURRENCY]: {
                available: 10000000,
                locked: 0
            },
            "TATA": {
                available: 10000000,
                locked: 0
            }
        });
    }





}