import { createClient } from 'redis';
type RedisClientType = ReturnType<typeof createClient>;
export const QUEUE = 'db_processor';
export const PROCESSING = `${QUEUE}:processing`;
export const FAILED = `${QUEUE}:failed`;
// Single worker by design. Claim survives process death; ack happens only after SQL commits.
export async function claim(redis: RedisClientType): Promise<string | null> {
    return await redis.lIndex(PROCESSING, -1) ?? await redis.blMove(QUEUE, PROCESSING, 'RIGHT', 'LEFT', 1);
}
export async function acknowledge(redis: RedisClientType, raw: string) {
    await redis.lRem(PROCESSING, 1, raw);
}
export async function quarantine(redis: RedisClientType, raw: string, error: string, attempts: number) {
    const record = JSON.stringify({ raw, error: error.slice(0, 500), attempts, failedAt: Date.now() });
    // Never trim unexamined failures. At capacity, leave the claim and pause consumption.
    return Number(await redis.eval(`
        if redis.call('LLEN',KEYS[1]) >= 1000 then return 0 end
        redis.call('LPUSH',KEYS[1],ARGV[1]); redis.call('LREM',KEYS[2],1,ARGV[2]); return 1`,
        { keys: [FAILED, PROCESSING], arguments: [record, raw] })) === 1;
}
export async function replayFailed(redis: RedisClientType, limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Replay limit must be 1–1000');
    return Number(await redis.eval(`
        local count=0
        for i=1,tonumber(ARGV[1]) do
            local item=redis.call('LINDEX',KEYS[1],-1)
            if not item then break end
            local record=cjson.decode(item)
            redis.call('LPUSH',KEYS[2],record.raw); redis.call('RPOP',KEYS[1]); count=count+1
        end
        return count`, { keys: [FAILED, QUEUE], arguments: [String(limit)] }));
}
