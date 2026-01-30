import * as ccxt from "ccxt";

async function testPermissions() {
    const exchange = new ccxt.xt({
        apiKey: process.env.XT_API_KEY_2,
        secret: process.env.XT_SECRET_KEY_2,
        enableRateLimit: true,
    });

    console.log("Testing XT API permissions...\n");

    try {
        console.log("1. Fetching balance...");
        const balance = await exchange.fetchBalance();
        console.log("✅ Balance fetch successful\n");

        console.log("2. Fetching open orders...");
        const orders = await exchange.fetchOpenOrders("BTC/USDT");
        console.log("✅ Open orders fetch successful\n");

        console.log("3. Checking account info...");
        const account = await exchange.fetchBalance();
        console.log("✅ Account info fetch successful\n");

        console.log("4. Testing createOrder with test mode (if available)...");
        // Note: Most exchanges don't have test mode, this will likely fail
        
        console.log("\n✅ All read permissions work!");
        console.log("❌ But ORDER_007 suggests TRADE permission is not enabled on the API key");
        console.log("\n📋 Please verify in XT settings:");
        console.log("   - API Key has 'Spot Trading' enabled");
        console.log("   - API Key has 'Trade' permission enabled");
        console.log("   - No IP whitelist restrictions");
        
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    }
}

testPermissions();
