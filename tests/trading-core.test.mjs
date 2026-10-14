import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../engine/dist/trade/engine.js';
import { parseDecimal, formatDecimal } from '../packages/contracts/dist/index.js';

const market = 'TATA_INR';
const cancel = (ctx, orderId) => {
  const owner = ctx.engine.getSnapshot().orderbooks.flatMap(b => [...b.bids, ...b.asks]).find(o => o.orderId === orderId)?.userId ?? '1';
  return ctx.engine.cancelOrder(market, orderId, owner);
};
function setup(options = {}) {
  let id = 0;
  const events = [], replies = [];
  const engine = new Engine({ orderId: () => `order-${++id}`, now: () => 1000,
    sink: { pushMessage: e => events.push(e), publishMessage: (c, e) => events.push(e), sendToApi: (c, r) => replies.push(r) }, ...options });
  const command = (type, data) => engine.process({ clientId: 'test', message: { type, data } });
  const place = (side, price, quantity, userId = side === 'buy' ? '1' : '2') =>
    engine.createOrder(market, price, quantity, side, userId);
  return { engine, events, replies, command, place };
}
const balance = (engine, id, symbol) => Object.fromEntries(engine.getSnapshot().balances)[id][symbol];
const totals = engine => {
  const result = {};
  for (const [, assets] of engine.getSnapshot().balances) for (const [symbol, b] of Object.entries(assets))
    result[symbol] = (result[symbol] ?? 0n) + BigInt(b.available) + BigInt(b.locked);
  return result;
};
const rejectsUnchanged = (ctx, action, code) => {
  const before = ctx.engine.getSnapshot(), count = ctx.events.length;
  assert.throws(action, e => e.code === code);
  assert.deepEqual(ctx.engine.getSnapshot(), before);
  assert.equal(ctx.events.length, count);
};

test('decimal parser rejects rounding, coercion and non-finite inputs', () => {
  for (const value of ['', ' ', '0', '-1', 'NaN', 'Infinity', '1e3', '0x10', '01', '.1', '1.', '1.001', '1000000.01', 1, null, {}, []])
    assert.throws(() => parseDecimal(value, 2));
  assert.equal(parseDecimal('0.01', 2), 1n);
  assert.equal(parseDecimal('1000000', 2), 100000000n);
  assert.equal(formatDecimal(parseDecimal('12.30', 2), 2), '12.3');
});
test('resting order reserves exact funds; full cancellation restores initial state', () => {
  for (const side of ['buy', 'sell']) {
    const ctx = setup(), before = ctx.engine.getSnapshot().balances;
    const order = ctx.place(side, '10.25', '2.1234');
    const b = balance(ctx.engine, side === 'buy' ? '1' : '2', side === 'buy' ? 'INR' : 'TATA');
    assert.equal(b.locked, side === 'buy' ? '21764850' : '2123400');
    assert.deepEqual(cancel(ctx, order.orderId), { orderId: order.orderId, executedQty: 0, remainingQty: 2.1234 });
    assert.deepEqual(ctx.engine.getSnapshot().balances, before);
    rejectsUnchanged(ctx, () => cancel(ctx, order.orderId), 'ORDER_NOT_FOUND');
  }
});
test('buyer price improvement is refunded; partial remainder has exact reserve', () => {
  const ctx = setup(), before = totals(ctx.engine);
  ctx.place('sell', '9', '1');
  const buy = ctx.place('buy', '10', '3');
  assert.equal(buy.executedQty, 1);
  assert.equal(balance(ctx.engine, '1', 'INR').locked, '20000000');
  assert.equal(balance(ctx.engine, '1', 'INR').available, '9999971000000');
  assert.deepEqual(cancel(ctx, buy.orderId), { orderId: buy.orderId, executedQty: 1, remainingQty: 2 });
  assert.equal(balance(ctx.engine, '1', 'INR').locked, '0');
  assert.equal(balance(ctx.engine, '1', 'INR').available, '9999991000000');
  assert.deepEqual(totals(ctx.engine), before);
});
test('partial sell cancellation releases base and reports executed quantity', () => {
  const ctx = setup();
  const ask = ctx.place('sell', '10', '3');
  ctx.place('buy', '10', '1');
  const quoteBefore = balance(ctx.engine, '2', 'INR');
  const result = cancel(ctx, ask.orderId);
  assert.equal(result.executedQty, 1);
  assert.equal(result.remainingQty, 2);
  assert.equal(balance(ctx.engine, '2', 'TATA').locked, '0');
  assert.equal(balance(ctx.engine, '2', 'TATA').available, '9999999000000');
  assert.deepEqual(balance(ctx.engine, '2', 'INR'), quoteBefore);
});
test('best-price then FIFO matching, maker-price execution and partial maker priority on both sides', () => {
  for (const taker of ['buy', 'sell']) {
    const ctx = setup(), maker = taker === 'buy' ? 'sell' : 'buy';
    const prices = taker === 'buy' ? ['11', '10', '10'] : ['9', '10', '10'];
    const orders = prices.map(p => ctx.place(maker, p, '2'));
    const result = ctx.place(taker, taker === 'buy' ? '12' : '8', '3');
    assert.deepEqual(result.fills.map(f => [f.price, f.qty]), [['10', 2], ['10', 1]]);
    const next = ctx.place(taker, taker === 'buy' ? '12' : '8', '2');
    assert.deepEqual(next.fills.map(f => [f.price, f.qty]), [['10', 1], [prices[0], 1]]);
    const makerUpdates = ctx.events.filter(e => e.type === 'ORDER_UPDATE' && !e.data.market);
    assert.deepEqual(makerUpdates.map(e => e.data.orderId), [orders[1].orderId, orders[2].orderId, orders[2].orderId, orders[0].orderId]);
    assert.deepEqual([...result.fills, ...next.fills].map(f => f.tradeId), [0, 1, 2, 3]);
  }
});
test('fractional fills and minimum tick/lot settle exactly without dust', () => {
  const ctx = setup(), before = totals(ctx.engine);
  ctx.place('sell', '0.01', '0.0003');
  for (let i = 0; i < 3; i++) ctx.place('buy', '0.02', '0.0001');
  assert.equal(balance(ctx.engine, '1', 'INR').available, '9999999999997');
  assert.equal(balance(ctx.engine, '1', 'INR').locked, '0');
  assert.equal(balance(ctx.engine, '2', 'TATA').locked, '0');
  assert.deepEqual(totals(ctx.engine), before);
  assert.deepEqual(ctx.command('GET_DEPTH', { market }).payload, { bids: [], asks: [] });
  assert.deepEqual(ctx.events.filter(e => e.type === 'TRADE_ADDED').map(e => e.data.quoteQuantity), ['0.000001', '0.000001', '0.000001']);
});
test('invalid direct commands and queue messages cannot alter balances or order books', () => {
  const ctx = setup();
  ctx.place('sell', '10', '1');
  for (const [price, quantity, side, userId, code] of [
    ['0', '1', 'buy', '1', 'INVALID_REQUEST'], ['NaN', '1', 'buy', '1', 'INVALID_REQUEST'],
    ['10', '0.00001', 'buy', '1', 'INVALID_REQUEST'], ['10', '1', 'other', '1', 'INVALID_REQUEST'],
    ['10', '1', 'buy', 'unknown', 'UNKNOWN_USER'], ['1000000', '1000000', 'buy', '1', 'INSUFFICIENT_FUNDS'],
  ]) rejectsUnchanged(ctx, () => ctx.engine.createOrder(market, price, quantity, side, userId), code);
  rejectsUnchanged(ctx, () => ctx.engine.createOrder('NOPE_INR', '1', '1', 'buy', '1'), 'UNKNOWN_MARKET');
  for (const message of [null, {}, { type: 'bad', data: {} }, { type: 'CREATE_ORDER', data: [] }]) {
    const before = ctx.engine.getSnapshot();
    const reply = ctx.engine.process({ clientId: 'x', message });
    assert.equal(reply.type, 'ERROR'); assert.equal(reply.payload.code, 'INVALID_REQUEST');
    assert.deepEqual(ctx.engine.getSnapshot(), before);
  }
  for (const type of ['GET_DEPTH', 'GET_OPEN_ORDERS', 'CANCEL_ORDER'])
    assert.equal(ctx.command(type, { market: 'NOPE_INR', userId: '1', orderId: 'missing' }).type, 'ERROR');
});
test('failed settlement validation discards draft matching and emits no events', () => {
  const ctx = setup();
  ctx.place('sell', '10', '1');
  // Deliberately corrupt a counterparty after startup to exercise the transaction boundary.
  ctx.engine.balances.delete('2');
  const snapshot = ctx.engine.getSnapshot(), events = ctx.events.length;
  assert.throws(() => ctx.place('buy', '10', '1'), /Unknown user/);
  assert.deepEqual(ctx.engine.getSnapshot(), snapshot);
  assert.equal(ctx.events.length, events);
});
test('self-match accounting conserves assets and releases both reserves', () => {
  const ctx = setup(), before = ctx.engine.getSnapshot().balances;
  ctx.place('sell', '9', '1', '1'); ctx.place('buy', '10', '1', '1');
  assert.deepEqual(ctx.engine.getSnapshot().balances, before);
});
test('newly funded buyer receives a previously absent asset; funding validates before deduplication', () => {
  const ctx = setup();
  rejectsUnchanged(ctx, () => ctx.engine.onRamp('new', 'NaN', 'txn'), 'INVALID_REQUEST');
  ctx.engine.onRamp('new', '100', 'txn');
  rejectsUnchanged(ctx, () => ctx.engine.onRamp('new', '100', 'txn'), 'DUPLICATE_TRANSACTION');
  ctx.place('sell', '10', '1'); ctx.place('buy', '11', '1', 'new');
  assert.equal(balance(ctx.engine, 'new', 'TATA').available, '1000000');
  assert.equal(balance(ctx.engine, 'new', 'INR').available, '90000000');
  assert.equal(balance(ctx.engine, 'new', 'INR').locked, '0');
});
test('depth is numerically sorted and consumed/cancelled levels publish zero tombstones', () => {
  const ctx = setup();
  ctx.place('sell', '10', '1'); ctx.place('sell', '9', '1');
  assert.deepEqual(ctx.command('GET_DEPTH', { market }).payload.asks, [['9', '1'], ['10', '1']]);
  ctx.place('buy', '10', '2');
  assert.deepEqual(ctx.events.filter(e => e.data?.e === 'depth').at(-1).data.a, [['9', '0'], ['10', '0']]);
  const bid = ctx.place('buy', '8', '1');
  cancel(ctx, bid.orderId);
  assert.deepEqual(ctx.events.filter(e => e.data?.e === 'depth').at(-1).data.b, [['8', '0']]);
});
test('trade maker flags depend on resting side, not user identity', () => {
  for (const side of ['buy', 'sell']) {
    const ctx = setup();
    ctx.place(side, '10', '1'); ctx.place(side === 'buy' ? 'sell' : 'buy', '10', '1');
    assert.equal(ctx.events.find(e => e.type === 'TRADE_ADDED').data.isBuyerMaker, side === 'buy');
    assert.equal(ctx.events.find(e => e.data?.e === 'trade').data.m, side === 'buy');
  }
});
test('versioned snapshots preserve integer state, FIFO, trade counters and funding deduplication', () => {
  const ctx = setup();
  ctx.engine.onRamp('new', '0.000001', 'fund');
  ctx.place('sell', '9.99', '0.3'); ctx.place('sell', '9.99', '0.4'); ctx.place('buy', '10', '0.1');
  const snapshot = JSON.parse(JSON.stringify(ctx.engine.getSnapshot()));
  const restored = setup({ snapshot });
  assert.notEqual(restored.engine.getSnapshot().generation, snapshot.generation);
  assert.deepEqual({ ...restored.engine.getSnapshot(), generation: snapshot.generation }, snapshot);
  const expected = ctx.place('buy', '10', '0.3');
  const actual = restored.place('buy', '10', '0.3');
  assert.deepEqual(actual.fills, expected.fills);
  rejectsUnchanged(restored, () => restored.engine.onRamp('new', '1', 'fund'), 'DUPLICATE_TRANSACTION');
  assert.throws(() => new Engine({ snapshot: { version: 1 } }), /Incompatible snapshot/);
  const corrupt = structuredClone(snapshot);
  corrupt.balances[0][1].INR.locked = '1';
  assert.throws(() => new Engine({ snapshot: corrupt }), /exact open-order reserves/);
});
test('seeded mixed-command run conserves each asset and exactly backs all open orders', () => {
  const ctx = setup(), before = totals(ctx.engine);
  let seed = 42;
  const random = n => { seed = (1664525 * seed + 1013904223) >>> 0; return seed % n; };
  for (let i = 0; i < 500; i++) {
    const side = random(2) ? 'buy' : 'sell', user = ['1', '2', '5'][random(3)];
    ctx.place(side, `${9 + random(3)}.${String(random(100)).padStart(2, '0')}`, `0.${String(1 + random(9999)).padStart(4, '0')}`, user);
    if (i % 3 === 0) {
      const open = ctx.command('GET_OPEN_ORDERS', { market, userId: user }).payload;
      if (open.length) cancel(ctx, open[random(open.length)].orderId);
    }
    assert.deepEqual(totals(ctx.engine), before);
    const snapshot = ctx.engine.getSnapshot();
    for (const [id, assets] of snapshot.balances) {
      let quote = 0n, base = 0n;
      for (const book of snapshot.orderbooks) {
        for (const o of book.bids.filter(o => o.userId === id)) quote += BigInt(o.price) * (BigInt(o.quantity) - BigInt(o.filled));
        for (const o of book.asks.filter(o => o.userId === id)) base += (BigInt(o.quantity) - BigInt(o.filled)) * 100n;
      }
      assert.equal(BigInt(assets.INR.locked), quote); assert.equal(BigInt(assets.TATA.locked), base);
      for (const b of Object.values(assets)) assert.ok(BigInt(b.available) >= 0n && BigInt(b.locked) >= 0n);
    }
  }
});
test('full improved-price fill unlocks all quote; noncrossing limits remain resting', () => {
  const ctx = setup();
  ctx.place('sell', '9', '1'); ctx.place('sell', '11', '1');
  ctx.place('buy', '10', '1');
  assert.equal(balance(ctx.engine, '1', 'INR').locked, '0');
  assert.deepEqual(ctx.command('GET_DEPTH', { market }).payload, { bids: [], asks: [['11', '1']] });
  ctx.place('buy', '10', '1');
  assert.deepEqual(ctx.command('GET_DEPTH', { market }).payload.bids, [['10', '1']]);
});
test('insufficient base, invalid cancellation, and cap rejection leave state untouched', () => {
  const ctx = setup(); ctx.engine.onRamp('new', '1', 'f');
  rejectsUnchanged(ctx, () => ctx.place('sell', '1', '1', 'new'), 'INSUFFICIENT_FUNDS');
  rejectsUnchanged(ctx, () => cancel(ctx, ''), 'INVALID_REQUEST');
  ctx.engine.orderbooks[0].lastTradeId = Number.MAX_SAFE_INTEGER;
  rejectsUnchanged(ctx, () => ctx.place('buy', '1', '1'), 'LIMIT_EXCEEDED');
});
test('repeated 0.1 fills fully remove a 0.3 maker without floating-point residue', () => {
  const ctx = setup(); ctx.place('sell', '0.1', '0.3');
  for (let i = 0; i < 3; i++) ctx.place('buy', '0.2', '0.1');
  assert.deepEqual(ctx.command('GET_DEPTH', { market }).payload, { bids: [], asks: [] });
  assert.equal(balance(ctx.engine, '1', 'INR').locked, '0');
  assert.equal(balance(ctx.engine, '2', 'TATA').locked, '0');
});
test('event transport exception never reports a committed trade as rejected', () => {
  const original = console.error; const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    const ctx = setup({ sink: { pushMessage() { throw new Error('unavailable'); }, publishMessage() {}, sendToApi() {} } });
    const result = ctx.command('CREATE_ORDER', { market, side: 'buy', price: '10', quantity: '1', userId: '1' });
    assert.equal(result.type, 'ORDER_PLACED');
    assert.equal(ctx.command('GET_OPEN_ORDERS', { market, userId: '1' }).payload.length, 1);
    assert.equal(errors.length, 1);
  } finally { console.error = original; }
});
