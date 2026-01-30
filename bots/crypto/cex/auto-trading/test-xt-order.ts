import * as ccxt from "ccxt";
import { initExchange } from "../exchange";

async function testOrder() {
    // Test with standard credentials first
    console.log("Testing with standard XT credentials...");
    const exchange1 = initExchange("xt");
    await exchange1.loadMarkets();
    const market1 = exchange1.markets["BNB/USDT"];
    console.log("Standard API - Market found:", market1?.symbol, "ID:", market1?.id);
    
    // Test with custom credentials
    console.log("\nTesting with custom XT credentials...");
    const exchange2 = new ccxt.xt({
        apiKey: process.env.XT_API_KEY_2,
        secret: process.env.XT_SECRET_KEY_2,
        enableRateLimit: true,
        timeout: 30000,
        recvWindow: 10000,
    });
    await exchange2.loadMarkets();
    const market2 = exchange2.markets["BNB/USDT"];
    console.log("Custom API - Market found:", market2?.symbol, "ID:", market2?.id);
    
    // Try a test order with very small amount
    try {
        console.log("\nAttempting test order with custom credentials...");
        const order = await exchange2.createOrder("BNB/USDT", "limit", "buy", 0.01, 600);
        console.log("✅ Order successful:", order.id);
    } catch (error: any) {
        console.log("❌ Order failed:", error.message);
    }
}

testOrder().catch(console.error);
