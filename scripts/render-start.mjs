import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../api/package.json", import.meta.url));
const { createClient } = require("redis");
const children = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let stopping = false;
let redis;

function launch(name, executable, args, env = {}) {
    if (stopping) throw new Error("Shutdown requested");
    const child = spawn(executable, args, {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, ...env }
    });
    const exited = new Promise(resolve => {
        child.once("exit", resolve);
        child.once("error", resolve);
    });
    children.set(name, { child, exited });
    child.once("error", error => {
        console.error(`[runtime] ${name}: ${error.message}`);
        void shutdown(1);
    });
    child.once("exit", code => {
        if (!stopping) {
            console.error(`[runtime] ${name} exited (${code}); restarting the whole demo`);
            void shutdown(1);
        }
    });
}

async function stop(name, milliseconds = 2000) {
    const entry = children.get(name);
    if (!entry || entry.child.exitCode !== null || entry.child.signalCode !== null) return;
    entry.child.kill("SIGTERM");
    await Promise.race([entry.exited, sleep(milliseconds)]);
    if (entry.child.exitCode === null && entry.child.signalCode === null) {
        entry.child.kill("SIGKILL");
        await entry.exited;
    }
}

async function shutdown(code) {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
        for (const { child } of children.values()) child.kill("SIGKILL");
        process.exit(1);
    }, 25000);
    // Stop new traffic and producers before draining committed persistence batches.
    await stop("gateway");
    await stop("market-maker", 5000);
    await stop("api");
    await stop("ws");
    await stop("engine", 5000);
    if (redis?.isReady) {
        const until = Date.now() + 5000;
        try {
            while (Date.now() < until) {
                const pending = await redis.lLen("db_processor");
                const processing = await redis.lLen("db_processor:processing");
                if (pending + processing === 0) break;
                await sleep(100);
            }
            const counts = await Promise.all(
                ["db_processor", "db_processor:processing", "db_processor:failed"].map(
                    key => redis.lLen(key)
                )
            );
            if (counts.some(Boolean)) {
                console.error(`[runtime] Unsaved events will be lost on restart: ${counts.join("/")}`);
                code = 1;
            }
        } catch {
            console.error("[runtime] Could not verify persistence drain");
            code = 1;
        }
    }
    await stop("db-processor", 3000);
    if (redis?.isOpen) redis.destroy();
    await stop("redis");
    clearTimeout(deadline);
    process.exit(code);
}

process.once("SIGTERM", () => void shutdown(0));
process.once("SIGINT", () => void shutdown(0));

async function main() {
    const port = Number(process.env.PORT ?? 10000);
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || [3000, 3001, 6379].includes(port))
        throw new Error("PORT must be an unprivileged port other than 3000, 3001 or 6379");
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    const origin = new URL(process.env.CORS_ORIGIN ?? "");
    if (origin.origin !== process.env.CORS_ORIGIN || origin.protocol !== "https:")
        throw new Error("CORS_ORIGIN must be the exact HTTPS frontend origin without a trailing slash");

    const state = await mkdtemp(join(tmpdir(), "arcturus-"));
    const env = {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        NODE_OPTIONS: "--max-old-space-size=64",
        REDIS_URL: "redis://127.0.0.1:6379",
        WORKER_LOCK_SCOPE: randomUUID(),
        DATABASE_MODE: process.env.DATABASE_MODE ?? "postgres",
        WITH_SNAPSHOT: "",
        SNAPSHOT_PATH: join(state, "snapshot.json"),
        API_BASE_URL: "http://127.0.0.1:3000",
        TOTAL_BIDS: "8",
        TOTAL_ASKS: "8",
        INTERVAL_MS: "3000"
    };
    // Redis and snapshots are intentionally private and ephemeral for each demo boot.
    launch("redis", "redis-server", [
        "--bind", "127.0.0.1", "--port", "6379", "--save", "", "--appendonly", "no",
        "--maxmemory", "32mb", "--maxmemory-policy", "noeviction", "--dir", state
    ]);
    redis = createClient({
        url: env.REDIS_URL,
        socket: { reconnectStrategy: retries => retries < 30 ? 100 : new Error("Redis startup failed") }
    });
    redis.on("error", () => {});
    await redis.connect();
    for (const service of ["db-processor", "engine", "ws", "api"]) {
        launch(service, process.execPath, [`${service}/dist/index.js`], {
            ...env,
            PORT: service === "ws" ? "3001" : "3000"
        });
    }
    const deadline = Date.now() + 90000;
    let ready = false;
    while (!stopping && Date.now() < deadline) {
        try {
            const response = await fetch("http://127.0.0.1:3000/readyz", {
                signal: AbortSignal.timeout(4000)
            });
            ready = response.ok && (await response.json()).status === "ready";
            if (ready) break;
        } catch {}
        await sleep(250);
    }
    if (!ready || stopping) throw new Error("Backend startup did not become ready");
    launch("market-maker", process.execPath, ["market-maker/dist/index.js"], env);
    const template = await readFile(join(root, "docker/render.nginx.conf"), "utf8");
    const config = join(state, "nginx.conf");
    await writeFile(config, template.replaceAll("__PORT__", String(port)).replaceAll("__STATE__", state));
    launch("gateway", "nginx", ["-c", config, "-g", "daemon off;"]);
    console.log(`[runtime] Fresh demo ready on port ${port}; saved history remains in PostgreSQL`);
}

main().catch(error => {
    console.error(`[runtime] Startup failed: ${error.message}`);
    void shutdown(1);
});
