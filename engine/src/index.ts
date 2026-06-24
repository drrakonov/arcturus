import dotenv from 'dotenv';
dotenv.config();
import { createClient } from 'redis';
import { Engine } from './trade/engine.js';
import { RedisManager } from './redisManager.js';

async function main() {
    // Connect the RedisManager singleton FIRST, before the Engine is
    // constructed or any messages are processed. This guarantees that
    // every subsequent publish/lPush call goes to a live connection.
    await RedisManager.connect();

    const engine = new Engine();

    const redisClient = createClient();
    await redisClient.connect();
    console.log("Engine is connected to Redis!");

    while (true) {
        try {
            // brPop waits for a message, 0 = block indefinitely
            const response = await redisClient.brPop("message", 0);

            if (response && response.element) {
                const message = JSON.parse(response.element);
                engine.process(message);
            }
        } catch (err) {
            console.error("Error processing message:", err);
            // Optional: wait a second before retrying on error
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
}

main();
