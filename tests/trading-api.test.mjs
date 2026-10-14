import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../engine/dist/trade/engine.js';
import { RedisManager } from '../api/dist/managers/redisManager.js';
import { createOrder, deleteOrder, getOpenOrder } from '../api/dist/controllers/order.controller.js';
import { getDepth } from '../api/dist/controllers/depth.controller.js';
import { createMarket } from '../api/dist/controllers/markets.controller.js';

// Controller contract checks with the real engine, substituting only the Redis transport.
test('API maps validation/business errors to non-success status and payloads', async () => {
  const engine = new Engine();
  const original = RedisManager.getInstance;
  let dispatches = 0;
  RedisManager.getInstance = () => ({
    sendAndAwait: async message => {
      dispatches++; return engine.process({ message, clientId: 'test' });
    }
  });
  const call = async (handler, req) => {
    const res = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler(req, res); return res;
  };
  try {
    for (const body of [undefined, {}, { market: 'TATA_INR', userId: '1', side: 'buy', price: 'NaN', quantity: '1' },
      { market: 'TATA_INR', userId: '1', side: 'buy', price: '10.001', quantity: '1' }]) {
      const res = await call(createOrder, { body });
      assert.equal(res.statusCode, 400); assert.equal(res.body.success, false);
    }
    assert.equal(dispatches, 0, 'invalid API payloads never reach the queue');
    const order = { market: 'TATA_INR', price: '1000000', quantity: '1000000', side: 'buy', userId: '1' };
    let res = await call(createOrder, { body: order });
    assert.equal(res.statusCode, 422); assert.equal(res.body.code, 'INSUFFICIENT_FUNDS');
    res = await call(createOrder, { body: { ...order, quantity: '1', userId: 'missing' } });
    assert.equal(res.statusCode, 404); assert.equal(res.body.code, 'UNKNOWN_USER');
    res = await call(deleteOrder, { body: { market: 'TATA_INR', orderId: 'missing' } });
    assert.equal(res.statusCode, 404); assert.equal(res.body.code, 'ORDER_NOT_FOUND');
    assert.equal((await call(getDepth, { query: {} })).statusCode, 400);
    assert.equal((await call(getDepth, { query: { symbol: ['TATA_INR'] } })).statusCode, 400);
    assert.equal((await call(getDepth, { query: { symbol: 'NOPE_INR' } })).statusCode, 404);
    assert.equal((await call(getOpenOrder, { query: { market: 'TATA_INR' } })).statusCode, 400);
    assert.equal((await call(createMarket, { body: { baseAsset: 'INR' } })).statusCode, 400);
    assert.equal((await call(createMarket, { body: { baseAsset: 'TEST' } })).statusCode, 201);
    assert.equal((await call(createMarket, { body: { baseAsset: 'TEST' } })).statusCode, 400);
    res = await call(createOrder, { body: { ...order, price: '10', quantity: '1' } });
    assert.equal(res.statusCode, 200); assert.equal(res.body.success, true);
    assert.equal((await call(deleteOrder, { body: { market: 'TATA_INR', orderId: res.body.payload.orderId } })).statusCode, 200);
  } finally { RedisManager.getInstance = original; }
});
