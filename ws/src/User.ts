import { WebSocket } from 'ws';
import { SubscriptionManager } from './SubscriptionManager.js';
import type { OutgoingMessage } from './types/out.js';

export class User {
    private accountId: string | undefined;
    private expiry: ReturnType<typeof setTimeout> | undefined;
    private closed = false;
    constructor(private id: string, private ws: WebSocket) {
        let pending = Promise.resolve();
        let queued = 0;
        ws.on('message', raw => {
            if (++queued > 20) { ws.close(1008, 'Too many subscription requests'); return; }
            pending = pending.then(() => this.receive(raw.toString())).catch(() => this.ws.close(1013, 'Subscription unavailable; reconnect'))
                .finally(() => { queued--; });
        });
        ws.on('close', () => { this.closed = true; clearTimeout(this.expiry); });
        ws.on('error', () => {});
    }
    private send(message: unknown) {
        if (this.ws.readyState !== WebSocket.OPEN) return;
        if (this.ws.bufferedAmount > 1_000_000) { this.ws.close(1013, 'Slow connection; reconnect'); return; }
        this.ws.send(JSON.stringify(message));
    }
    emit(message: OutgoingMessage) { this.send(message.data.e === 'trace' ? { ...message, data: { ...message.data, forwardedAt: Date.now() } } : message); }
    private async receive(raw: string) {
        if (this.closed) return;
        let message;
        try { message = JSON.parse(raw); } catch { this.send({ type: 'ERROR', message: 'Invalid JSON' }); return; }
        if (!message || typeof message !== 'object') { this.send({ type: 'ERROR', message: 'Invalid message' }); return; }
        const manager = SubscriptionManager.getInstance();
        if (message.method === 'PING') { this.send({ type: 'PONG' }); return; }
        if (message.method === 'AUTH') {
            if (this.accountId) { this.send({ type: 'ERROR', message: 'Already authenticated' }); return; }
            const session = await manager.authenticate(message.token);
            if (!session) { this.ws.close(4001, 'Session expired or invalid'); return; }
            if (this.closed) return;
            this.accountId = session.userId;
            this.expiry = setTimeout(() => this.ws.close(4001, 'Session expired'), session.expiresAt - Date.now());
            await manager.subscribe(this.id, `account@${session.userId}`);
            if (this.closed) { manager.userLeft(this.id); return; }
            this.send({ type: 'READY', userId: session.userId });
            return;
        }
        if (!['SUBSCRIBE', 'UNSUBSCRIBE'].includes(message.method) || !Array.isArray(message.params) || message.params.length > 8 ||
            message.params.some((s: unknown) => typeof s !== 'string' || !/^(market|depth|trade|ticker)@[A-Z][A-Z0-9]{0,11}_INR$/.test(s))) {
            this.send({ type: 'ERROR', message: 'Only public market streams may be requested; private stream is assigned by session' }); return;
        }
        if (message.method === 'SUBSCRIBE') {
            if (new Set([...manager.getSubscriptions(this.id), ...message.params]).size > 9) {
                this.send({ type: 'ERROR', message: 'Subscription limit reached' }); return;
            }
            for (const channel of message.params) await manager.subscribe(this.id, channel);
            if (this.closed) { manager.userLeft(this.id); return; }
            this.send({ type: 'SUBSCRIBED', params: message.params });
        } else {
            for (const channel of message.params) manager.unsubscribe(this.id, channel);
            this.send({ type: 'UNSUBSCRIBED', params: message.params });
        }
    }
}
