// Small process-presence guard shared by host services and the offline reset tool.
export const RESET_KEY = 'runtime:reset';
export const HEARTBEAT_PREFIX = 'runtime:service:';
export interface RuntimeRedis {
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}
export async function startHeartbeat(redis: RuntimeRedis, service: string, onFailure: (error: unknown) => void) {
    const key = `${HEARTBEAT_PREFIX}${service}:${crypto.randomUUID()}`;
    let stopped = false, running = false;
    const pulse = async () => {
        const result = await redis.eval(`if redis.call('EXISTS',KEYS[1])==1 then return 0 end
            redis.call('SET',KEYS[2],ARGV[1],'EX',8); return 1`,
            { keys: [RESET_KEY,key], arguments: [String(Date.now())] });
        if (Number(result) !== 1) throw new Error('Offline demo reset is active; service startup refused');
    };
    await pulse();
    const timer = setInterval(() => {
        if (stopped || running) return;
        running = true;
        void pulse().catch(error => { if (!stopped) onFailure(error); }).finally(() => { running = false; });
    },2000);
    return async () => {
        stopped = true; clearInterval(timer);
        await redis.eval("return redis.call('DEL',KEYS[1])",{keys:[key],arguments:[]}).catch(()=>{});
    };
}
