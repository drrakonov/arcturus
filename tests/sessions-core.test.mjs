import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../engine/dist/trade/engine.js';
const market = 'SOL_INR';
const call = (engine, type, data, extra = {}) => engine.process({ clientId: 'test', message: { type, data }, ...extra });
const account = (engine, userId) => call(engine, 'GET_ACCOUNT', { userId }).payload;

test('demo provisioning is idempotent, exact and isolated', () => {
  const engine = new Engine();
  for (const userId of ['alice', 'bob']) {
    const a = call(engine, 'CREATE_ACCOUNT', { userId });
    assert.equal(a.type, 'ACCOUNT');
    assert.deepEqual(a.payload.balances, { INR: { available: '100000', locked: '0' }, SOL: { available: '100', locked: '0' } });
  }
  const order = call(engine, 'CREATE_ORDER', { market, side: 'buy', price: '9', quantity: '2', userId: 'alice' });
  assert.equal(account(engine, 'bob').openOrders.length, 0);
  assert.equal(account(engine, 'alice').balances.INR.locked, '18');
  call(engine, 'CREATE_ACCOUNT', { userId: 'alice' });
  assert.equal(account(engine, 'alice').balances.INR.locked, '18');
  const before = engine.getSnapshot();
  const forbidden = call(engine, 'CANCEL_ORDER', { market, orderId: order.payload.orderId, userId: 'bob' });
  assert.equal(forbidden.payload.code, 'ORDER_NOT_FOUND');
  assert.deepEqual(engine.getSnapshot(), before);
  call(engine, 'CANCEL_ORDER', { market, orderId: order.payload.orderId, userId: 'alice' });
  assert.equal(account(engine, 'alice').balances.INR.available, '100000');
});
test('private updates contain only the matching accounts; market stream has no account details', () => {
  const events = [];
  const engine = new Engine({ sink: { pushMessage() {}, sendToApi() {}, publishMessage: (channel, data) => events.push({ channel, data }) } });
  for (const userId of ['alice', 'bob', 'carol']) call(engine, 'CREATE_ACCOUNT', { userId });
  call(engine, 'CREATE_ORDER', { market, side: 'sell', price: '9', quantity: '2', userId: 'alice' });
  events.length = 0;
  call(engine, 'CREATE_ORDER', { market, side: 'buy', price: '10', quantity: '1', userId: 'bob' });
  const updates = events.filter(e => e.channel.startsWith('account@'));
  assert.deepEqual(updates.map(e => e.data.data.snapshot.userId).sort(), ['alice', 'bob']);
  assert.equal(account(engine, 'bob').balances.INR.available, '99991');
  assert.equal(account(engine, 'bob').balances.SOL.available, '101');
  const publicMarket = events.find(e => e.channel.startsWith('market@')).data.data.snapshot;
  assert.equal(publicMarket.trades.length, 1);
  assert.equal(JSON.stringify(publicMarket).includes('alice'), false);
  assert.equal(JSON.stringify(publicMarket).includes('bob'), false);
});
test('duplicate requests replay, conflicting bodies reject, accounts have separate key scopes', () => {
  const engine = new Engine();
  const data = { market, side: 'buy', price: '9', quantity: '2', userId: '1' };
  const first = call(engine, 'CREATE_ORDER', data, { requestId: 'same-request' });
  const after = engine.getSnapshot();
  assert.deepEqual(call(engine, 'CREATE_ORDER', data, { requestId: 'same-request' }), first);
  assert.deepEqual(engine.getSnapshot(), after);
  assert.equal(call(engine, 'CREATE_ORDER', { ...data, quantity: '3' }, { requestId: 'same-request' }).payload.code, 'REQUEST_CONFLICT');
  assert.equal(call(engine, 'CREATE_ORDER', { ...data, userId: '2' }, { requestId: 'same-request' }).type, 'ORDER_PLACED');
  const restored = new Engine({ snapshot: engine.getSnapshot() });
  assert.deepEqual(call(restored, 'CREATE_ORDER', data, { requestId: 'same-request' }), first);
  const cancellation = { market, userId: '1', orderId: first.payload.orderId };
  const result = call(engine, 'CANCEL_ORDER', cancellation, { requestId: 'cancel-request' });
  assert.deepEqual(call(engine, 'CANCEL_ORDER', cancellation, { requestId: 'cancel-request' }), result);
});
test('expired queued commands do not execute and request cache is bounded with expiry', () => {
  let now = 1000;
  const engine = new Engine({ now: () => now });
  const data = { market, side: 'buy', price: '9', quantity: '1', userId: '1' };
  const before = engine.getSnapshot();
  assert.equal(call(engine, 'CREATE_ORDER', data, { requestId: 'expired-request', expiresAt: 999 }).payload.code, 'REQUEST_TIMEOUT');
  assert.deepEqual(engine.getSnapshot(), before);
  for (let i = 0; i < 10000; i++) engine.requests.set(`x:${i}`, { fingerprint: '', expires: 1001, response: { type: 'ACK', payload: { message: '' } } });
  assert.equal(call(engine, 'CREATE_ORDER', data, { requestId: 'new-request' }).payload.code, 'LIMIT_EXCEEDED');
  now = 1002;
  assert.equal(call(engine, 'CREATE_ORDER', data, { requestId: 'new-request' }).type, 'ORDER_PLACED');
  assert.equal(engine.requests.size, 1);
});

test('legacy stock snapshots are rejected rather than relabeled as SOL executions', () => {
  const snapshot = new Engine().getSnapshot();
  snapshot.orderbooks[0].baseAsset = 'TATA';
  assert.throws(() => new Engine({ snapshot }), /Legacy TATA snapshot/);
  assert.equal(snapshot.orderbooks[0].baseAsset, 'TATA');
});
