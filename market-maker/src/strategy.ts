export function seededRandom(seed: string) {
    let state = 2166136261;
    for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

export function setting(value: string | undefined, fallback: number, min: number, max: number) {
    if (value === undefined) return fallback;
    if (
        !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value) ||
        !Number.isFinite(+value) ||
        +value < min ||
        +value > max
    )
        throw new Error("Invalid simulator setting");
    return +value;
}

export function units(value: string, decimals: number) {
    if (!/^\d+(\.\d+)?$/.test(value)) throw new Error("Invalid balance");
    const [whole, fraction = ""] = value.split(".");
    if (fraction.length > decimals) throw new Error("Unsupported balance precision");
    return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
}

export function decimal(value: bigint, digits: number) {
    const scale = 10n ** BigInt(digits);
    return `${value / scale}.${(value % scale).toString().padStart(digits, "0")}`;
}

export function planQuotes(
    midCents: number,
    bids: number,
    asks: number,
    quote: bigint,
    base: bigint,
    random: () => number
) {
    const result: { side: "buy" | "sell"; price: string; quantity: string }[] = [];
    for (let i = 0; i < Math.max(bids, asks); i++)
        for (const side of ["buy", "sell"] as const) {
            if (i >= (side === "buy" ? bids : asks)) continue;
            const price = BigInt(
                midCents + (side === "buy" ? -1 : 1) * (20 + Math.floor(random() * 500))
            );
            const desired = BigInt(1000 + Math.floor(random() * 9000));
            const affordable = side === "buy" ? quote / price : base / 100n;
            const qty = desired < affordable ? desired : affordable;
            if (qty <= 0n) continue;
            if (side === "buy") quote -= price * qty;
            else base -= qty * 100n;
            result.push({ side, price: decimal(price, 2), quantity: decimal(qty, 4) });
        }
    return result;
}
