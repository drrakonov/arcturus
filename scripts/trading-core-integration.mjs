// Runs host services against user-managed local Redis/PostgreSQL; never invokes Docker.
// Creates and removes its own PostgreSQL database; requires an unused Redis DB 15.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.env.SMOKE_DISPOSABLE !== '1') throw new Error('Set SMOKE_DISPOSABLE=1 for local disposable integration');
const root = fileURLToPath(new URL('../', import.meta.url));
const requireApi = createRequire(new URL('../api/package.json', import.meta.url));
const { Pool } = requireApi('pg');
const { createClient } = requireApi('redis');
const { WebSocket } = createRequire(new URL('../ws/package.json', import.meta.url))('ws');
const dir = await mkdtemp(join(tmpdir(), 'arcturus-m2-'));
const db = `arcturus_m2_${process.pid}_${Date.now()}`;
const pgConfig = { host: '127.0.0.1', port: Number(process.env.TEST_POSTGRES_PORT ?? 15432),
  user: 'your_user', password: 'your_password', connectionTimeoutMillis: 3000 };
const redisUrl = `redis://127.0.0.1:${Number(process.env.TEST_REDIS_PORT ?? 16379)}/15`;
const env = { ...process.env, REDIS_URL: redisUrl, POSTGRES_HOST: pgConfig.host,
  POSTGRES_PORT: String(pgConfig.port), POSTGRES_USER: pgConfig.user, POSTGRES_PASSWORD: pgConfig.password,
  API_BASE_URL: `http://127.0.0.1:${Number(process.env.TEST_API_PORT ?? 13000)}`, TOTAL_BIDS: '4', TOTAL_ASKS: '4', INTERVAL_MS: '250',
  POSTGRES_DB: db, WITH_SNAPSHOT: '', CORS_ORIGIN: 'http://127.0.0.1:15173', REQUEST_TIMEOUT_MS: '1200' };
const apiPort = Number(process.env.TEST_API_PORT ?? 13000), wsPort = Number(process.env.TEST_WS_PORT ?? 13001);
const children = [], events = [];
let logs = '', created = false, ownsRedis = false, pool, socket, privateSocket;
const admin = new Pool({ ...pgConfig, database: 'my_database' });
const redis = createClient({ url: redisUrl, socket: { reconnectStrategy: false, connectTimeout: 3000 } });
redis.on('error', () => {});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function launch(service, port) {
  const child = spawn(process.execPath, [join(root, service, 'dist/index.js')], {
    cwd: dir, env: { ...env, PORT: String(port ?? 0) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.on('error', error => { logs += `${service}: ${error.message}\n`; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { logs += `[${service}] ${data}`; });
  return child;
}
async function until(check, label) {
  for (let i = 0; i < 100; i++) {
    if (children.some(c => c.exitCode !== null)) throw new Error('Service exited during integration');
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
async function request(path, body, status = 200, method = 'POST', token, key = randomUUID()) {
  const res = await fetch(`http://127.0.0.1:${apiPort}${path}`, { method: body ? method : 'GET',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(4000) });
  const result = await res.json();
  assert.equal(res.status, status, `${path}: ${JSON.stringify(result)}`);
  return result;
}
async function session() {
  const { payload } = await request('/api/v1/session', {}, 201);
  return payload;
}

try {
  await redis.connect();
  assert.equal(await redis.dbSize(), 0, 'Redis DB 15 must be unused; refusing mutation');
  ownsRedis = true;
  await admin.query(`CREATE DATABASE ${db}`); created = true;
  pool = new Pool({ ...pgConfig, database: db });
  await pool.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
  launch('db-processor');
  await until(() => logs.includes('Waiting for messages'), 'worker migrations');
  launch('engine'); launch('api', apiPort); launch('ws', wsPort);
  await until(async () => {
    try { return (await fetch(`http://127.0.0.1:${apiPort}/`, { signal: AbortSignal.timeout(300) })).ok &&
      logs.includes('Engine is connected to Redis!') && logs.includes('SubscriptionManager: Redis client connected.'); }
    catch { return false; }
  }, 'service readiness');
  socket = new WebSocket(`ws://127.0.0.1:${wsPort}`);
  socket.on('message', raw => events.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ method: 'SUBSCRIBE', params: ['depth@SOL_INR', 'trade@SOL_INR'] }));
  await until(() => events.some(e => e.type === 'SUBSCRIBED'), 'public subscription acknowledgement');
  const seller = await session(), buyer = await session();
  assert.notEqual(seller.userId, buyer.userId);
  await request('/api/v1/account', undefined, 401);
  await request('/api/v1/order', {}, 401);
  const initial = (await request('/api/v1/account', undefined, 200, 'GET', buyer.token)).payload;
  assert.deepEqual(initial.balances, { INR: { available: '100000', locked: '0' }, SOL: { available: '100', locked: '0' } });
  assert.equal((await request('/api/v1/session', {}, 200, 'POST', buyer.token)).payload.userId, buyer.userId);
  const privateEvents = [];
  privateSocket = new WebSocket(`ws://127.0.0.1:${wsPort}`);
  privateSocket.on('message', raw => privateEvents.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => { privateSocket.once('open', resolve); privateSocket.once('error', reject); });
  privateSocket.send(JSON.stringify({ method: 'AUTH', token: buyer.token }));
  await until(() => privateEvents.some(e => e.type === 'READY'), 'private subscription');
  privateSocket.send(JSON.stringify({ method: 'SUBSCRIBE', params: [`account@${seller.userId}`] }));
  await until(() => privateEvents.some(e => e.type === 'ERROR'), 'foreign private stream rejection');
  const order = { market: 'SOL_INR', price: '0.01', quantity: '0.0003', side: 'sell', userId: '2' };
  const invalid = await request('/api/v1/order', { ...order, price: 'NaN' }, 400, 'POST', seller.token);
  assert.equal(invalid.code, 'INVALID_REQUEST');
  const poor = await request('/api/v1/order', { ...order, side: 'buy', price: '1000000', quantity: '1000000' }, 422, 'POST', buyer.token);
  assert.equal(poor.code, 'INSUFFICIENT_FUNDS');
  const key = randomUUID();
  const [sell, duplicate] = await Promise.all([
    request('/api/v1/order', { ...order, userId: buyer.userId }, 200, 'POST', seller.token, key),
    request('/api/v1/order', { ...order, userId: buyer.userId }, 200, 'POST', seller.token, key),
  ]);
  assert.deepEqual(sell, duplicate);
  await request('/api/v1/order', { ...order, quantity: '1' }, 409, 'POST', seller.token, key);
  assert.equal((await request(`/api/v1/order/open?market=SOL_INR&userId=${seller.userId}`, undefined, 200, 'GET', buyer.token)).payload.length, 0);
  await request('/api/v1/order', { market: 'SOL_INR', orderId: sell.payload.orderId }, 404, 'DELETE', buyer.token);
  assert.equal(privateEvents.filter(e => e.data?.e === 'account').length, 0, 'seller activity must not reach buyer private stream');
  const buy = await request('/api/v1/order', { ...order, side: 'buy', userId: '1', price: '0.02', quantity: '0.0001' }, 200, 'POST', buyer.token);
  assert.equal(buy.payload.executedQty, 0.0001);
  assert.equal(buy.payload.fills[0].price, '0.01');
  const cancelled = await request('/api/v1/order', { market: 'SOL_INR', orderId: sell.payload.orderId }, 200, 'DELETE', seller.token);
  assert.equal(cancelled.payload.executedQty, 0.0001); assert.equal(cancelled.payload.remainingQty, 0.0002);
  const missing = await request('/api/v1/order', { market: 'SOL_INR', orderId: sell.payload.orderId }, 404, 'DELETE', seller.token);
  assert.equal(missing.code, 'ORDER_NOT_FOUND');
  await until(async () => {
    const history = await request('/api/v1/trades?symbol=SOL_INR');
    return history.payload.length === 1 && events.some(e => e.data?.e === 'trade') &&
      events.some(e => e.data?.e === 'depth' && e.data.a.some(([p, q]) => p === '0.01' && q === '0'));
  }, 'database and WebSocket events');
  const trade = (await pool.query('SELECT price, quantity, quote_qty, is_buyer_maker FROM trades')).rows[0];
  assert.equal(Number(trade.price), 0.01); assert.equal(Number(trade.quantity), 0.0001);
  assert.equal(trade.quote_qty, '0.000001'); assert.equal(trade.is_buyer_maker, false);
  await until(async () => {
    const rows = (await pool.query('SELECT executed_qty FROM orders')).rows;
    return rows.length === 2 && rows.every(r => Number(r.executed_qty) === 0.0001);
  }, 'maker/taker order persistence');
  assert.deepEqual((await request('/api/v1/depth?symbol=SOL_INR')).payload, { bids: [], asks: [] });
  await until(() => privateEvents.some(e => e.data?.e === 'account'), 'private account notification');
  assert.ok(privateEvents.filter(e => e.data?.e === 'account').every(e => e.data.snapshot.userId === buyer.userId));
  const finalBuyer = (await request('/api/v1/account', undefined, 200, 'GET', buyer.token)).payload;
  assert.equal(finalBuyer.balances.INR.available, '99999.999999');
  assert.equal(finalBuyer.balances.SOL.available, '100.0001');
  await redis.del(`demo:session:${seller.token}`);
  await request('/api/v1/account', undefined, 401, 'GET', seller.token);
  if (process.env.TEST_BROWSER === '1') {
    const vite = spawn(process.execPath, [join(root, 'frontend/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '15173', '--strictPort'], {
      cwd: join(root, 'frontend'), env: { ...process.env, VITE_API_URL: `http://127.0.0.1:${apiPort}`, VITE_WS_URL: `ws://127.0.0.1:${wsPort}` }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(vite);
    for (const stream of [vite.stdout, vite.stderr]) stream.on('data', data => { logs += `[vite] ${data}`; });
    await until(async () => { try { return (await fetch('http://127.0.0.1:15173')).ok; } catch { return false; } }, 'frontend');
    const browser = spawn(process.execPath, [join(root, 'frontend/node_modules/@playwright/test/cli.js'), 'test'], {
      cwd: join(root, 'frontend'), env: { ...process.env, TEST_API_URL: `http://127.0.0.1:${apiPort}`, TEST_ARTIFACT_DIR: dir }, stdio: 'inherit',
    });
    const browserExit = await new Promise((resolve, reject) => { browser.once('exit', resolve); browser.once('error', reject); });
    await writeFile(join(dir, 'services.log'), logs);
    assert.equal(browserExit, 0, 'browser tests');
  }
  const maker = launch('market-maker');
  await until(async () => {
    const { payload } = await request('/api/v1/market?symbol=SOL_INR');
    return payload.bids.length > 0 && payload.asks.length > 0 &&
      payload.trades.some(t => Number(t.price) > 900) && payload.candles['5s'].length > 0;
  }, 'simulator supplies real quotes, fills and candles');
  maker.kill('SIGTERM');
  // A stopped consumer must produce a bounded HTTP error, not an indefinitely hanging request.
  children.find(c => c.spawnargs.includes(join(root, 'engine', 'dist/index.js'))).kill('SIGTERM');
  await delay(400);
  const snapshot = JSON.parse(await readFile(join(dir, 'snapshot.json'), 'utf8'));
  const balances = Object.fromEntries(snapshot.balances);
  assert.equal(balances[buyer.userId].INR.available, '99999999999'); assert.equal(balances[buyer.userId].INR.locked, '0');
  assert.equal(balances[seller.userId].SOL.available, '99999900'); assert.equal(balances[seller.userId].SOL.locked, '0');
  const timeout = await request('/api/v1/order', { ...order, side: 'buy' }, 504, 'POST', buyer.token);
  assert.equal(timeout.code, 'REQUEST_TIMEOUT');
  console.log('PASS: authenticated sessions, ownership, concurrent deduplication, bounded timeout, private notifications;  real HTTP/Redis/engine/worker/PostgreSQL/WebSocket integration; exact fractional settlement, refund, partial cancellation, errors, events and order persistence.');
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  socket?.terminate(); privateSocket?.terminate();
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  await delay(500);
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  if (pool) await pool.end();
  if (created) await admin.query(`DROP DATABASE ${db} WITH (FORCE)`);
  await admin.end();
  if (redis.isOpen) {
    if (ownsRedis) {
      const keys = await redis.keys('demo:session:*');
      await redis.del(['message', 'db_processor', ...keys]);
    }
    await redis.quit();
  }
  await writeFile(join(dir, 'services.log'), logs);
  console.log(`Logs and isolated snapshot: ${dir}. Disposable resources cleaned up; no Docker commands executed.`);
}
