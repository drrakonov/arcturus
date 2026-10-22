import dotenv from 'dotenv';
dotenv.config();
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { decimal, planQuotes, seededRandom, setting, units } from './strategy.js';

const MARKET = process.env.MARKET ?? 'SOL_INR';
if (!/^[A-Z][A-Z0-9]{0,11}_INR$/.test(MARKET)) throw new Error('Invalid simulator market');
const baseAsset = MARKET.split('_')[0]!;
const seed = process.env.SIMULATOR_SEED ?? 'arcturus-demo';
const random = seededRandom(seed);
const TOTAL_BIDS = setting(process.env.TOTAL_BIDS,15,0,50), TOTAL_ASKS = setting(process.env.TOTAL_ASKS,15,0,50);
const INTERVAL = setting(process.env.INTERVAL_MS,2000,100,60000);
if (![TOTAL_BIDS,TOTAL_ASKS,INTERVAL].every(Number.isInteger)) throw new Error('Counts and interval must be integers');
const STALE = setting(process.env.STALE_SPREAD,2,.01,50) * 100;
const CHURN = setting(process.env.RANDOM_CHURN,.05,0,1);
const maxTicks = setting(process.env.SIMULATOR_TICKS,0,0,1000000);
if (!Number.isInteger(maxTicks)) throw new Error('SIMULATOR_TICKS must be an integer');
const client = axios.create({ baseURL: process.env.API_BASE_URL ?? 'http://localhost:3000', timeout: 8000 });
let token = '', mid = 100000, takeBuy = true, stopped = false;
process.once('SIGINT', () => { stopped = true; });
process.once('SIGTERM', () => { stopped = true; });
const headers = () => ({ Authorization: `Bearer ${token}` });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
interface OpenOrder { orderId: string; market: string; side: 'buy' | 'sell'; price: number }
interface Account { openOrders: OpenOrder[]; balances: Record<string, { available: string }> }
async function account(): Promise<Account> { return (await client.get('/api/v1/account', { headers: headers() })).data.payload; }
async function mutate(method: 'post' | 'delete', body: object) {
    const key = randomUUID();
    for (let attempt=0; attempt<3; attempt++) {
        try { return (await client.request({ url: '/api/v1/order', method, data: body, headers: { ...headers(), 'Idempotency-Key': key } })).data.payload; }
        catch (error) {
            if (axios.isAxiosError(error) && error.response && error.response.status < 500) throw error;
            if (attempt===2) throw new Error('Uncertain execution after retries; simulator stopped. Inspect its orders before restarting.');
            await sleep(250 * 2 ** attempt);
        }
    }
}
async function cancel(orderId: string) {
    try { await mutate('delete', { market: MARKET, orderId }); }
    catch (error) { if (!axios.isAxiosError(error) || error.response?.status !== 404) throw error; }
}
async function tick() {
    mid = Math.max(98000,Math.min(102000,mid+Math.floor((random()-.5)*200)));
    let state = await account();
    for (const o of state.openOrders.filter(o => o.market === MARKET)) {
        if (stopped) return;
        const stale = o.side === 'buy' ? Math.round(o.price*100) < mid-STALE : Math.round(o.price*100) > mid+STALE;
        if (stale || random()<CHURN) await cancel(o.orderId);
    }
    state = await account();
    const orders = state.openOrders.filter(o => o.market === MARKET);
    const quote = units(state.balances.INR?.available ?? '0',6), base = units(state.balances[baseAsset]?.available ?? '0',6);
    const plan = planQuotes(mid,Math.max(0,TOTAL_BIDS-orders.filter(o=>o.side==='buy').length),
        Math.max(0,TOTAL_ASKS-orders.filter(o=>o.side==='sell').length),quote,base,random);
    for (const order of plan) {
        if (stopped) return;
        try { await mutate('post',{ market: MARKET, ...order }); }
        catch (error) { if (!axios.isAxiosError(error) || error.response?.data?.code !== 'INSUFFICIENT_FUNDS') throw error; }
    }
    // Real small taker orders, never synthetic trades. Remove any unfilled remainder.
    state = await account();
    const price = BigInt(mid+(takeBuy ? 600 : -600));
    const funds = units(state.balances[takeBuy ? 'INR' : baseAsset]?.available ?? '0',6);
    const affordable = funds/(takeBuy ? price : 100n), qty = affordable < 500n ? affordable : 500n;
    if (qty > 0n && !stopped) {
        const result = await mutate('post',{ market: MARKET, side: takeBuy ? 'buy' : 'sell', price: decimal(price,2),quantity: decimal(qty,4) });
        if (result.executedQty < Number(decimal(qty,4))) await cancel(result.orderId);
    }
    takeBuy = !takeBuy;
    console.log(`[simulator] mid=${decimal(BigInt(mid),2)} quotes submitted=${plan.length}; finite virtual balances`);
}
async function run() {
    token = (await client.post('/api/v1/session')).data.payload.token;
    console.log(`[simulator] market=${MARKET} seed=${seed} interval=${INTERVAL}ms; real engine executions, self-matching allowed`);
    try {
        for (let count=0; !stopped && (!maxTicks || count<maxTicks); count++) {
            await tick();
            for (let wait=0; !stopped && wait<INTERVAL; wait+=100) await sleep(Math.min(100,INTERVAL-wait));
        }
    } finally {
        // Best effort on graceful stop; no minting, refills or silent session replacement.
        const state = await account();
        for (const order of state.openOrders.filter(o=>o.market===MARKET)) await cancel(order.orderId);
    }
}
void run().catch(error => { console.error('[simulator]', error.message); process.exitCode=1; });
