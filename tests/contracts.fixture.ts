import type { MessageFromApi, MessageToApi, WsMessage, DbMessage } from '@arcturus/contracts';

// These fixtures cover the previously inconsistent producer/consumer types.
const emptyBook: MessageToApi = { type: 'DEPTH', payload: { bids: [], asks: [] } };
const levels: MessageToApi = { type: 'DEPTH', payload: { bids: [['100', '1'], ['99', '2']], asks: [] } };
const unfilled: MessageToApi = { type: 'ORDER_PLACED', payload: { orderId: 'a', executedQty: 0, fills: [] } };
const open: MessageToApi = { type: 'OPEN_ORDERS', payload: [{ orderId: 'a', price: 100, quantity: 2, filled: 1, side: 'buy', userId: '1' }] };
const funding: MessageFromApi = { type: 'ON_RAMP', data: { userId: '1', amount: '100', txnId: 'txn' } };
const trade: WsMessage = { stream: 'trade@SOL_INR', data: { e: 'trade', t: 0, m: false, p: '100', q: '1', s: 'SOL_INR' } };
const depth: WsMessage = { stream: 'depth@SOL_INR', data: { e: 'depth', a: [], b: [] } };
const full: DbMessage = { type: 'ORDER_UPDATE', data: { orderId: 'a', executedQty: 0, market: 'SOL_INR', price: '100', quantity: '1', side: 'buy' } };
const partial: DbMessage = { type: 'ORDER_UPDATE', data: { orderId: 'a', executedQty: 1 } };
// @ts-expect-error The old API typo must not silently reappear.
const oldFunding: MessageFromApi = { type: 'ON_RAMP', data: { userId: '1', amount: '100', tnxId: 'txn' } };
// @ts-expect-error Full database updates require all original order fields.
const incomplete: DbMessage = { type: 'ORDER_UPDATE', data: { orderId: 'a', executedQty: 0, market: 'SOL_INR' } };
void [emptyBook, levels, unfilled, open, funding, trade, depth, full, partial, oldFunding, incomplete];
