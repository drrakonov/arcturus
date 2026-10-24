import { useCallback, useEffect, useRef, useState } from "react";
import { mergeMarket } from "./market";
import { ApiError, newer, request, wsUrl } from "./client";
import type { AccountSnapshot, MarketSnapshot, PendingAction, Session } from "./client";

export function useTerminal() {
    const [session, setSession] = useState<Session | null>(null);
    const [account, setAccount] = useState<AccountSnapshot | null>(null);
    const [market, setMarket] = useState<MarketSnapshot | null>(null);
    const [status, setStatus] = useState("connecting");
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const [pending, setPending] = useState<PendingAction | null>(() => {
        try {
            return JSON.parse(sessionStorage.getItem("arcturus-pending") || "null");
        } catch {
            return null;
        }
    });
    const [attempt, setAttempt] = useState(0);
    const socket = useRef<WebSocket | null>(null);
    const inFlight = useRef(false);
    useEffect(() => {
        let cancelled = false;
        setStatus("connecting");
        setError("");
        const token = sessionStorage.getItem("arcturus-token") || undefined;
        request<Session>("/api/v1/session", token, { method: "POST" })
            .then(value => {
                if (cancelled) return;
                sessionStorage.setItem("arcturus-token", value.token);
                setSession(value);
            })
            .catch(err => {
                if (!cancelled) {
                    setError(err.message);
                    setStatus(err.code === "UNAUTHORIZED" ? "expired" : "failed");
                }
            });
        return () => {
            cancelled = true;
        };
    }, [attempt]);
    useEffect(() => {
        if (!session) return;
        let stopped = false,
            retry: ReturnType<typeof setTimeout>,
            failures = 0;
        let interval: ReturnType<typeof setInterval>;
        let refresh: ReturnType<typeof setInterval>;
        const connect = () => {
            if (stopped) return;
            setStatus(failures ? "reconnecting" : "connecting");
            const ws = new WebSocket(wsUrl);
            socket.current = ws;
            let lastReceived = Date.now();
            let syncing = false;
            const handshake = setTimeout(() => ws.close(), 10_000);
            const sync = async () => {
                if (syncing) return;
                syncing = true;
                try {
                    const [a, m] = await Promise.all([
                        request<AccountSnapshot>("/api/v1/account", session.token),
                        request<MarketSnapshot>("/api/v1/market?symbol=SOL_INR", session.token)
                    ]);
                    if (stopped || socket.current !== ws || ws.readyState !== WebSocket.OPEN)
                        return;
                    setAccount(old => newer(old, a));
                    setMarket(old => mergeMarket(old, m));
                    setStatus("live");
                    failures = 0;
                } catch (err) {
                    if (stopped || socket.current !== ws) return;
                    const e = err as ApiError;
                    setError(e.message);
                    if (["UNAUTHORIZED", "UNKNOWN_USER"].includes(e.code)) {
                        setStatus("expired");
                        ws.close(4001);
                    } else {
                        setStatus("reconnecting");
                        ws.close();
                    }
                } finally {
                    syncing = false;
                }
            };
            ws.onopen = () => {
                ws.send(JSON.stringify({ method: "AUTH", token: session.token }));
                interval = setInterval(() => {
                    if (Date.now() - lastReceived > 25_000) ws.close();
                    else if (ws.readyState === WebSocket.OPEN)
                        ws.send(JSON.stringify({ method: "PING" }));
                }, 10_000);
            };
            ws.onmessage = event => {
                if (stopped || socket.current !== ws) return;
                lastReceived = Date.now();
                let message;
                try {
                    message = JSON.parse(event.data);
                } catch {
                    return;
                }
                if (message.type === "READY")
                    ws.send(JSON.stringify({ method: "SUBSCRIBE", params: ["market@SOL_INR"] }));
                if (message.type === "SUBSCRIBED") {
                    clearTimeout(handshake);
                    void sync();
                    refresh = setInterval(() => void sync(), 15_000);
                }
                if (message.data?.e === "market")
                    setMarket(old => mergeMarket(old, message.data.snapshot));
                if (
                    message.data?.e === "account" &&
                    message.data.snapshot.userId === session.userId
                ) {
                    setAccount(old => newer(old, message.data.snapshot));
                    setNotice("Account updated · balances and open orders synchronized");
                }
                if (message.type === "ERROR") setError(message.message);
            };
            ws.onclose = event => {
                clearTimeout(handshake);
                clearInterval(interval);
                clearInterval(refresh);
                if (stopped) return;
                if (event.code === 4001) {
                    setStatus("expired");
                    setError("Your demo session is no longer available. Start a new session.");
                    return;
                }
                setStatus("reconnecting");
                failures++;
                retry = setTimeout(connect, Math.min(10_000, 500 * 2 ** Math.min(failures, 5)));
            };
            ws.onerror = () => ws.close();
        };
        const online = () => {
            if (socket.current?.readyState === WebSocket.CLOSED) {
                clearTimeout(retry);
                connect();
            }
        };
        const offline = () => {
            setStatus("reconnecting");
            socket.current?.close();
        };
        window.addEventListener("online", online);
        window.addEventListener("offline", offline);
        connect();
        return () => {
            window.removeEventListener("online", online);
            window.removeEventListener("offline", offline);
            cleanup();
        };
        function cleanup() {
            stopped = true;
            clearTimeout(retry);
            clearInterval(interval);
            clearInterval(refresh);
            socket.current?.close();
        }
    }, [session]);
    const execute = useCallback(
        async (action: PendingAction) => {
            if (!session || inFlight.current) return;
            if (Date.now() - action.createdAt >= 9 * 60_000) {
                setError(
                    "Retry window ended. Check open orders and balances before clearing this request."
                );
                return;
            }
            inFlight.current = true;
            setBusy(true);
            setError("");
            setPending(action);
            sessionStorage.setItem("arcturus-pending", JSON.stringify(action));
            try {
                const result = await request<{
                    executedQty: number;
                    orderId: string;
                    cancelledQty?: number;
                }>(action.path, session.token, action);
                setNotice(
                    action.method === "DELETE"
                        ? "Order cancelled · remaining funds released"
                        : result.executedQty > 0
                          ? `Order accepted · ${result.executedQty} SOL filled${result.cancelledQty ? ` · ${result.cancelledQty} cancelled` : ""}`
                          : "Limit order placed · waiting for a matching order"
                );
                setPending(null);
                sessionStorage.removeItem("arcturus-pending");
                try {
                    const a = await request<AccountSnapshot>("/api/v1/account", session.token);
                    setAccount(old => newer(old, a));
                } catch {
                    setError(
                        "Order confirmed. Account refresh delayed; reconnecting updates will reconcile it."
                    );
                }
            } catch (err) {
                const e = err as ApiError;
                setError(e.message);
                if (!e.uncertain) {
                    setPending(null);
                    sessionStorage.removeItem("arcturus-pending");
                }
            } finally {
                inFlight.current = false;
                setBusy(false);
            }
        },
        [session]
    );
    const mutate = (method: string, body: unknown, label: string) => {
        if (pending || status !== "live") return;
        void execute({
            path: "/api/v1/order",
            method,
            body,
            key: crypto.randomUUID(),
            createdAt: Date.now(),
            label
        });
    };
    const restart = () => {
        socket.current?.close();
        setSession(null);
        setAccount(null);
        setMarket(null);
        sessionStorage.removeItem("arcturus-token");
        sessionStorage.removeItem("arcturus-pending");
        setPending(null);
        setAttempt(x => x + 1);
    };
    return {
        session,
        account,
        market,
        status,
        error,
        notice,
        busy,
        pending,
        mutate,
        retry: () => (pending ? void execute(pending) : setAttempt(x => x + 1)),
        restart,
        dismissError: () => setError(""),
        clearPending: () => {
            setPending(null);
            sessionStorage.removeItem("arcturus-pending");
        }
    };
}
