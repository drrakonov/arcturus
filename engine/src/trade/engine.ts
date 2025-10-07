import type { Orderbook } from "./orderbook.js";

export const BASE_CURRENCY = "INR";

interface UserBalance {
    [key: string] : {
        available: number;
        locked: number;
    }
}

export class Engine {
    //Engine logic...
}