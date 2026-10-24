// Offline reset only. Does not run Docker or delete SQL history.
import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import { copyFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { Engine } from "../engine/dist/trade/engine.js";
import { saveSnapshot } from "../engine/dist/snapshot.js";

const require = createRequire(new URL("../api/package.json", import.meta.url));

const { createClient } = require("redis");

export async function resetDemo({ redisUrl, snapshotPath, confirmed }) {
    if (!confirmed || !redisUrl || !snapshotPath || !isAbsolute(snapshotPath))
        throw new Error(
            "Offline reset requires RESET_DEMO=1, explicit REDIS_URL and absolute SNAPSHOT_PATH"
        );
    const redis = createClient({
        url: redisUrl,
        socket: { connectTimeout: 3000, reconnectStrategy: false },
        disableOfflineQueue: true
    });
    redis.on("error", () => {});
    const lock = "runtime:reset",
        owner = randomUUID();
    let acquired = false;
    try {
        await redis.connect();
        const result = await redis.eval(
            `if redis.call('EXISTS',KEYS[1])==1 or #redis.call('KEYS','runtime:service:*')>0 then return 0 end
      redis.call('SET',KEYS[1],ARGV[1],'EX',60);return 1`,
            { keys: [lock], arguments: [owner] }
        );
        if (Number(result) !== 1)
            throw new Error(
                "Stop all app services and wait eight seconds before resetting; another reset may also be active"
            );
        acquired = true;
        for (const key of [
            "message",
            "db_processor",
            "db_processor:processing",
            "db_processor:failed"
        ])
            if (await redis.lLen(key))
                throw new Error(`Reset refused: ${key} is not empty. Drain or inspect it first.`);
        const keys = await redis.keys("demo:session:*");
        let backup = null;
        try {
            await access(snapshotPath);
            backup = `${snapshotPath}.reset-${Date.now()}-${owner}.bak`;
            await copyFile(snapshotPath, backup, constants.COPYFILE_EXCL);
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
        // If preflight took too long, do not touch live state after losing the guard.
        if ((await redis.get(lock)) !== owner)
            throw new Error("Reset guard expired before snapshot replacement");
        saveSnapshot(snapshotPath, new Engine().getSnapshot());
        const removed = await redis.eval(
            `if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end
      for i=2,#KEYS do redis.call('DEL',KEYS[i]) end;return 1`,
            { keys: [lock, ...keys], arguments: [owner] }
        );
        if (Number(removed) !== 1)
            throw new Error(
                "Reset guard expired; snapshot is fresh but session cleanup needs a guarded retry"
            );
        return { backup, snapshotPath, historyPreserved: true };
    } finally {
        if (acquired && redis.isReady)
            await redis
                .eval(
                    "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",
                    { keys: [lock], arguments: [owner] }
                )
                .catch(() => {});
        if (redis.isOpen) await redis.quit();
    }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
    resetDemo({
        redisUrl: process.env.REDIS_URL,
        snapshotPath: process.env.SNAPSHOT_PATH,
        confirmed: process.env.RESET_DEMO === "1"
    })
        .then(result => console.log(JSON.stringify({ event: "demo_reset_complete", ...result })))
        .catch(error => {
            console.error("Demo reset failed:", error.message);
            process.exitCode = 1;
        });
}
