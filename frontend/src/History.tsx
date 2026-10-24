import { useEffect, useState } from "react";
import { request } from "./client";
import type { HistoryOrder, HistoryPage } from "../../packages/contracts/src/index";

interface Trade {
    id: string;
    price: string;
    quantity: string;
    quoteQuantity: string;
    timestamp: number;
    side: string;
}

const number = (value: string) =>
    Number(value).toLocaleString("en-IN", { maximumFractionDigits: 6 });

export function History({
    token,
    revision,
    onInspect
}: {
    token?: string;
    revision?: number;
    onInspect: (id: string) => void;
}) {
    const [kind, setKind] = useState<"orders" | "trades">("orders");
    const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
    const [data, setData] = useState<HistoryPage<HistoryOrder | Trade> | null>(null);
    const [error, setError] = useState(""),
        [loading, setLoading] = useState(false),
        [refresh, setRefresh] = useState(0);
    const cursor = cursors.at(-1);
    useEffect(() => {
        setCursors([undefined]);
        setData(null);
    }, [token, kind]);
    useEffect(() => {
        if (!token) return;
        let stopped = false,
            inFlight = false;
        const load = async () => {
            if (inFlight) return;
            inFlight = true;
            setLoading(true);
            try {
                const path = kind === "orders" ? "/api/v1/order/history" : "/api/v1/account/trades";
                const page = await request<HistoryPage<HistoryOrder | Trade>>(
                    `${path}?market=SOL_INR&limit=50${cursor ? `&cursor=${cursor}` : ""}`,
                    token
                );
                if (!stopped) {
                    setData(page);
                    setError("");
                }
            } catch {
                if (!stopped)
                    setError(
                        "History is unavailable. Trading balances and open orders are still shown live."
                    );
            } finally {
                inFlight = false;
                if (!stopped) setLoading(false);
            }
        };
        // Coalesce bursts of account notifications; poll for asynchronous database delivery.
        const soon = setTimeout(() => void load(), 0);
        const timer = setInterval(() => void load(), 5000);
        return () => {
            stopped = true;
            clearTimeout(soon);
            clearInterval(timer);
        };
    }, [token, kind, cursor, revision, refresh]);
    return (
        <div className="history-panel">
            <div className="history-controls">
                <div>
                    <button
                        aria-pressed={kind === "orders"}
                        onClick={() => {
                            setKind("orders");
                            setData(null);
                        }}
                    >
                        Order history
                    </button>
                    <button
                        aria-pressed={kind === "trades"}
                        onClick={() => {
                            setKind("trades");
                            setData(null);
                        }}
                    >
                        Trade history
                    </button>
                </div>
                <button
                    disabled={loading || !token}
                    onClick={() => {
                        setCursors([undefined]);
                        setRefresh(v => v + 1);
                    }}
                >
                    Refresh history
                </button>
            </div>
            <p className="history-note" role="status">
                {loading
                    ? "Loading history…"
                    : "Saved history · recent actions may take a moment to appear."}
            </p>
            {error && (
                <p className="history-error" role="alert">
                    {error}
                </p>
            )}
            <div className="table-scroll" data-native-scroll>
                <table aria-label={kind === "orders" ? "Order history" : "Trade history"}>
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>Side</th>
                            <th>Price</th>
                            <th>Quantity</th>
                            <th>{kind === "orders" ? "Filled" : "Value (INR)"}</th>
                            {kind === "orders" && (
                                <>
                                    <th>Status</th>
                                    <th>Execution</th>
                                </>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {data?.rows.map(row =>
                            "orderId" in row ? (
                                <tr key={row.orderId}>
                                    <td>{new Date(row.updatedAt).toLocaleString()}</td>
                                    <td className={`${row.side}-text`}>{row.side}</td>
                                    <td>{number(row.price)}</td>
                                    <td>{number(row.quantity)}</td>
                                    <td>{number(row.executedQty)}</td>
                                    <td>{row.status.replace("_", " ")}</td>
                                    <td>
                                        <button onClick={() => onInspect(row.orderId)}>
                                            Inspect
                                        </button>
                                    </td>
                                </tr>
                            ) : (
                                <tr key={row.id}>
                                    <td>{new Date(row.timestamp).toLocaleString()}</td>
                                    <td className={`${row.side}-text`}>{row.side}</td>
                                    <td>{number(row.price)}</td>
                                    <td>{number(row.quantity)}</td>
                                    <td>{number(row.quoteQuantity)}</td>
                                </tr>
                            )
                        )}
                    </tbody>
                </table>
            </div>
            {!data?.rows.length && !loading && !error && (
                <div className="empty compact">No saved {kind} for this account yet.</div>
            )}
            <div className="history-controls">
                <button
                    disabled={loading || cursors.length === 1}
                    onClick={() => {
                        setData(null);
                        setCursors(c => c.slice(0, -1));
                    }}
                >
                    Previous page
                </button>
                <span>Page {cursors.length}</span>
                <button
                    disabled={loading || !data?.nextCursor}
                    onClick={() => {
                        setCursors(c => [...c, data!.nextCursor!]);
                        setData(null);
                    }}
                >
                    Next page
                </button>
            </div>
        </div>
    );
}
