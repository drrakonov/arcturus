export async function wakeBackend(baseUrl: string, signal: AbortSignal): Promise<void> {
    const deadline = new AbortController();
    const timeout = setTimeout(() => deadline.abort(), 90_000);
    const lifetime = AbortSignal.any([signal, deadline.signal]);

    try {
        while (!lifetime.aborted) {
            const attempt = new AbortController();
            const attemptTimeout = setTimeout(() => attempt.abort(), 8_000);

            try {
                const response = await fetch(`${baseUrl.replace(/\/$/, "")}/readyz`, {
                    signal: AbortSignal.any([lifetime, attempt.signal]),
                    cache: "no-store",
                    credentials: "omit"
                });

                if (response.ok && (await response.json()).status === "ready") return;
            } catch {
                // Cold starts can return an HTML loading page or interrupt the connection.
            } finally {
                clearTimeout(attemptTimeout);
            }

            if (lifetime.aborted) break;

            await new Promise<void>(resolve => {
                const finish = () => {
                    clearTimeout(pause);
                    lifetime.removeEventListener("abort", finish);
                    resolve();
                };
                const pause = setTimeout(finish, 3_000);
                lifetime.addEventListener("abort", finish, { once: true });
                if (lifetime.aborted) finish();
            });
        }

        throw new Error("Trading services are still unavailable. Please retry in a moment.");
    } finally {
        clearTimeout(timeout);
    }
}
