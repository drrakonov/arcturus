// Explicitly opt in: this places real orders in an isolated, disposable baseline.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const requireWs = createRequire(new URL('../ws/package.json', import.meta.url));
const { WebSocket } = requireWs('ws');
const api = process.env.API_BASE_URL || 'http://localhost:3000';
const wsUrl = process.env.WS_URL || 'ws://localhost:3001';

if (process.env.SMOKE_DISPOSABLE !== '1') {
  console.error('Refusing to place orders: set SMOKE_DISPOSABLE=1 for a disposable local stack.');
  process.exit(1);
}

async function request(path, body) {
  const response = await fetch(`${api}${path}`, {
    signal: AbortSignal.timeout(5000),
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  const result = await response.json();
  assert.equal(result.success, true);
  return result.payload;
}

const socket = new WebSocket(wsUrl);
const events = [];
socket.on('message', raw => events.push(JSON.parse(raw.toString())));
socket.on('error', () => {});
const deadline = setTimeout(() => { console.error('Smoke check timed out'); process.exit(1); }, 20000);
try {
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ method: 'SUBSCRIBE', params: ['depth@TATA_INR', 'trade@TATA_INR'] }));
  const depth = await request('/api/v1/depth?symbol=TATA_INR');
  assert.deepEqual(depth, { bids: [], asks: [] }, 'Use a fresh engine with the market maker stopped');
  assert.deepEqual(await request('/api/v1/trades?symbol=TATA_INR&limit=1'), [],
    'Use a fresh disposable database, so old trade IDs cannot satisfy this check');
  // Existing WS protocol has no subscription acknowledgement.
  await new Promise(resolve => setTimeout(resolve, 300));
  const sell = await request('/api/v1/order', { market: 'TATA_INR', price: '1000', quantity: '1', side: 'sell', userId: '2' });
  assert.ok(sell.orderId);
  const buy = await request('/api/v1/order', { market: 'TATA_INR', price: '1000', quantity: '1', side: 'buy', userId: '1' });
  assert.equal(buy.executedQty, 1);
  assert.equal(buy.fills.length, 1);
  assert.equal(buy.fills[0].price, '1000');
  let persisted = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const trades = await request('/api/v1/trades?symbol=TATA_INR&limit=100');
    const open = await request('/api/v1/order/open?userId=1&market=TATA_INR');
    assert.equal(open.length, 0);
    persisted = trades.some(t => t.id === String(buy.fills[0].tradeId) && t.price === '1000');
    if (persisted && events.some(e => e.data.e === 'trade' && e.data.t === buy.fills[0].tradeId)) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(persisted, 'Trade persisted through the database processor');
  assert.ok(events.some(e => e.data.e === 'depth'), 'Depth event delivered');
  assert.ok(events.some(e => e.data.e === 'trade' && e.data.t === buy.fills[0].tradeId), 'Matching trade delivered');
  console.log('PASS: HTTP → Redis → engine → database history and WebSocket trade/depth.');
} finally {
  clearTimeout(deadline);
  socket.terminate();
}
