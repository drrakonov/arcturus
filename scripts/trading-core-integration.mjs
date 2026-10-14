// Runs host services against user-managed local Redis/PostgreSQL; never invokes Docker.
// Creates and removes its own PostgreSQL database; requires an unused Redis DB 15.
import assert from 'node:assert/strict';
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
const dir = await mkdtemp(join(tmpdir(), 'arcturus-m1-'));
const db = `arcturus_m1_${process.pid}_${Date.now()}`;
const pgConfig = { host: '127.0.0.1', port: Number(process.env.TEST_POSTGRES_PORT ?? 15432),
  user: 'your_user', password: 'your_password', connectionTimeoutMillis: 3000 };
const redisUrl = `redis://127.0.0.1:${Number(process.env.TEST_REDIS_PORT ?? 16379)}/15`;
const env = { ...process.env, REDIS_URL: redisUrl, POSTGRES_HOST: pgConfig.host,
  POSTGRES_PORT: String(pgConfig.port), POSTGRES_USER: pgConfig.user, POSTGRES_PASSWORD: pgConfig.password,
  POSTGRES_DB: db, WITH_SNAPSHOT: '', CORS_ORIGIN: 'http://localhost:5173' };
const apiPort = Number(process.env.TEST_API_PORT ?? 13000), wsPort = Number(process.env.TEST_WS_PORT ?? 13001);
const children = [], events = [];
let logs = '', created = false, ownsRedis = false, pool, socket;
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
}
async function until(check, label) {
  for (let i = 0; i < 100; i++) {
    if (children.some(c => c.exitCode !== null)) throw new Error('Service exited during integration');
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
async function request(path, body, status = 200, method = 'POST') {
  const res = await fetch(`http://127.0.0.1:${apiPort}${path}`, { method: body ? method : 'GET',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(3000) });
  assert.equal(res.status, status);
  return res.json();
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
  socket.send(JSON.stringify({ method: 'SUBSCRIBE', params: ['depth@TATA_INR', 'trade@TATA_INR'] }));
  await delay(300); // Existing protocol has no subscription acknowledgement.
  const order = { market: 'TATA_INR', price: '0.01', quantity: '0.0003', side: 'sell', userId: '2' };
  const invalid = await request('/api/v1/order', { ...order, price: 'NaN' }, 400);
  assert.equal(invalid.code, 'INVALID_REQUEST');
  const poor = await request('/api/v1/order', { ...order, side: 'buy', price: '1000000', quantity: '1000000' }, 422);
  assert.equal(poor.code, 'INSUFFICIENT_FUNDS');
  const sell = await request('/api/v1/order', order);
  const buy = await request('/api/v1/order', { ...order, side: 'buy', userId: '1', price: '0.02', quantity: '0.0001' });
  assert.equal(buy.payload.executedQty, 0.0001);
  assert.equal(buy.payload.fills[0].price, '0.01');
  const cancelled = await request('/api/v1/order', { market: 'TATA_INR', orderId: sell.payload.orderId }, 200, 'DELETE');
  assert.equal(cancelled.payload.executedQty, 0.0001); assert.equal(cancelled.payload.remainingQty, 0.0002);
  const missing = await request('/api/v1/order', { market: 'TATA_INR', orderId: sell.payload.orderId }, 404, 'DELETE');
  assert.equal(missing.code, 'ORDER_NOT_FOUND');
  await until(async () => {
    const history = await request('/api/v1/trades?symbol=TATA_INR');
    return history.payload.length === 1 && events.some(e => e.data.e === 'trade') &&
      events.some(e => e.data.e === 'depth' && e.data.a.some(([p, q]) => p === '0.01' && q === '0'));
  }, 'database and WebSocket events');
  const trade = (await pool.query('SELECT price, quantity, quote_qty, is_buyer_maker FROM trades')).rows[0];
  assert.equal(Number(trade.price), 0.01); assert.equal(Number(trade.quantity), 0.0001);
  assert.equal(trade.quote_qty, '0.000001'); assert.equal(trade.is_buyer_maker, false);
  await until(async () => {
    const rows = (await pool.query('SELECT executed_qty FROM orders')).rows;
    return rows.length === 2 && rows.every(r => Number(r.executed_qty) === 0.0001);
  }, 'maker/taker order persistence');
  assert.deepEqual((await request('/api/v1/depth?symbol=TATA_INR')).payload, { bids: [], asks: [] });
  children.find(c => c.spawnargs.includes(join(root, 'engine', 'dist/index.js'))).kill('SIGTERM');
  await delay(400);
  const snapshot = JSON.parse(await readFile(join(dir, 'snapshot.json'), 'utf8'));
  const balances = Object.fromEntries(snapshot.balances);
  assert.equal(balances['1'].INR.available, '9999999999999'); assert.equal(balances['1'].INR.locked, '0');
  assert.equal(balances['2'].TATA.available, '9999999999900'); assert.equal(balances['2'].TATA.locked, '0');
  console.log('PASS: real HTTP/Redis/engine/worker/PostgreSQL/WebSocket integration; exact fractional settlement, refund, partial cancellation, errors, events and order persistence.');
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  socket?.terminate();
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  await delay(500);
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  if (pool) await pool.end();
  if (created) await admin.query(`DROP DATABASE ${db} WITH (FORCE)`);
  await admin.end();
  if (redis.isOpen) {
    if (ownsRedis) await redis.del(['message', 'db_processor']);
    await redis.quit();
  }
  await writeFile(join(dir, 'services.log'), logs);
  console.log(`Logs and isolated snapshot: ${dir}. Disposable resources cleaned up; no Docker commands executed.`);
}
