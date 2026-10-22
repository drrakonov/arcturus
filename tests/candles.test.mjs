import test from 'node:test';
import assert from 'node:assert/strict';
import { addFill, CANDLE_LIMIT } from '../engine/dist/trade/candles.js';
import { Engine } from '../engine/dist/trade/engine.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(new URL('../frontend/package.json', import.meta.url))('typescript');
const code = ts.transpileModule(readFileSync(new URL('../frontend/src/market.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { mergeMarket } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('candles aggregate actual fills with exact OHLC/volume and no invented empty bars', () => {
  const rows = [];
  addFill(rows, 1000n, 1n, 1000, '5s');
  addFill(rows, 1200n, 2n, 2000, '5s');
  addFill(rows, 900n, 3n, 3000, '5s');
  addFill(rows, 1100n, 4n, 4000, '5s');
  addFill(rows, 1300n, 1n, 15000, '5s');
  assert.deepEqual(rows, [
    { time: 0, open: '10', high: '12', low: '9', close: '11', volume: '0.001' },
    { time: 15, open: '13', high: '13', low: '13', close: '13', volume: '0.0001' },
  ]);
  for (let i = 4; i < 1000; i++) addFill(rows, 1000n, 1n, i * 5000, '5s');
  assert.equal(rows.length, CANDLE_LIMIT);
  assert.equal(rows.at(-1).time, 4995);
});
test('engine candles reflect fills only, restore from snapshots, and WS sends bounded current bars', () => {
  let now = 1000;
  const events = [];
  const engine = new Engine({ now: () => now, sink: { sendToApi() {}, pushMessage() {}, publishMessage: (channel, message) => events.push({ channel, message }) } });
  engine.createOrder('SOL_INR', '10', '3', 'sell', '2');
  assert.equal(engine.getMarket('SOL_INR').candles['5s'].length, 0);
  engine.createOrder('SOL_INR', '11', '1', 'buy', '1');
  now = 6000;
  engine.createOrder('SOL_INR', '11', '1', 'buy', '1');
  const market = engine.getMarket('SOL_INR');
  assert.equal(market.candles['5s'].length, 2);
  assert.equal(market.candles['1m'][0].volume, '2');
  assert.equal(market.candles['5s'][0].close, '10'); // maker price, not limit price
  const ws = events.filter(e => e.channel === 'market@SOL_INR').at(-1).message.data.snapshot;
  assert.equal(ws.candleHistory, false);
  assert.equal(ws.candles['5s'].length, 1);
  assert.deepEqual(new Engine({ snapshot: engine.getSnapshot() }).getMarket('SOL_INR').candles, market.candles);
});
test('late history backfills candles without rolling back live updates; new generation clears old history', () => {
  const candle = (time, close) => ({ time, open: '10', high: '12', low: '9', close, volume: '1' });
  const base = { market: 'SOL_INR', generation: 'a', bids: [], asks: [], trades: [] };
  const live = { ...base, revision: 3, candleHistory: false, candles: { '5s': [candle(5, '12')], '1m': [] } };
  const history = { ...base, revision: 2, candleHistory: true, candles: { '5s': [candle(0, '10'), candle(5, '11')], '1m': [] } };
  const result = mergeMarket(live, history);
  assert.equal(result.revision, 3);
  assert.deepEqual(result.candles['5s'].map(c => c.close), ['10', '12']);
  const reset = { ...history, generation: 'b', candles: { '5s': [], '1m': [] } };
  assert.deepEqual(mergeMarket(result, reset), reset);
});

test('persisted candles backfill older bars without replacing live OHLC or double counting volume', async () => {
  const { mergeCandles } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const candle = (time, volume) => ({ time, open:'10', high:'11', low:'9', close:'10', volume });
  const rows = mergeCandles([candle(0,'1'),candle(5,'1')],[candle(5,'2'),candle(10,'1')]);
  assert.deepEqual(rows.map(c=>[c.time,c.volume]),[[0,'1'],[5,'2'],[10,'1']]);
  assert.equal(mergeCandles(rows,rows).length,3);
  assert.equal(mergeCandles(rows,[],2)[0].time,5);
});

test('reconnecting history repairs incomplete old bars without letting delayed SQL shrink observed volume', async () => {
  const { backfillCandles } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const c = (time, volume) => ({time,open:'10',high:'10',low:'10',close:'10',volume});
  const rows = backfillCandles([c(0,'1'),c(5,'3')],[c(0,'2'),c(5,'2'),c(10,'1')]);
  assert.deepEqual(rows.map(c=>c.volume),['2','3','1']);
});
