/**
 * Market Making Strategy - Spread (Both Sides)
 * Functional approach - Places orders on BOTH sides (bid AND ask)
 * User specifies total amount in quote currency for each side
 */

import * as ccxt from "ccxt";
import { initExchange, type ExchangeName } from "../exchange";
import * as marketData from "../market-data";
import * as trading from "../trading";
import * as account from "../account";

const botConfig: SpreadMMConfig = {
    exchange: "xt",
    symbol: "ORBD/USDT",
    bidTotalQuoteAmount: 5.5, // $5.5 worth for buying
    askTotalQuoteAmount: 5.5, // $5.5 worth for selling
    spreadPercent: 0.5, // 0.5% spread on each side
    numberOfOrders: 10, // 10 orders per side (20 total)
    priceReference: "mid" // Use mid price as reference
};

export interface SpreadMMConfig {
    exchange: ExchangeName;
    symbol: string;
    bidTotalQuoteAmount: number; // Total amount in quote currency for BID side
    askTotalQuoteAmount: number; // Total amount in quote currency for ASK side
    spreadPercent: number; // Spread percentage on each side
    numberOfOrders: number; // Number of orders per side
    priceReference?: "first_ask" | "first_bid" | "mid" | "best";
}

export interface SpreadOrder {
    id: string;
    side: "buy" | "sell";
    price: number;
    amount: number;
    quoteValue: number;
}

export interface SpreadMMResult {
    config: SpreadMMConfig;
    currentPrice: number;
    bidOrders: SpreadOrder[];
    askOrders: SpreadOrder[];
    totalBidAmount: number;
    totalAskAmount: number;
}

/**
 * Get current reference price
 */
async function getReferencePrice(
    exchange: ccxt.Exchange,
    symbol: string,
    priceReference: "first_ask" | "first_bid" | "mid" | "best"
): Promise<number> {
    const ticker = await marketData.fetchTicker(exchange, symbol);

    switch (priceReference) {
        case "first_ask":
            return ticker.ask || ticker.last || 0;
        case "first_bid":
            return ticker.bid || ticker.last || 0;
        case "mid":
            if (ticker.bid && ticker.ask) {
                return (ticker.bid + ticker.ask) / 2;
            }
            return ticker.last || 0;
        case "best":
            if (ticker.bid && ticker.ask) {
                return (ticker.bid + ticker.ask) / 2;
            }
            return ticker.last || 0;
        default:
            return ticker.last || 0;
    }
}

/**
 * Calculate order distribution for one side
 */
function calculateOrderDistribution(
    referencePrice: number,
    side: "bid" | "ask",
    totalQuoteAmount: number,
    spreadPercent: number,
    numberOfOrders: number
): Array<{ price: number; quoteAmount: number }> {
    const orders: Array<{ price: number; quoteAmount: number }> = [];
    const quoteAmountPerOrder = totalQuoteAmount / numberOfOrders;
    const spreadDecimal = spreadPercent / 100;

    for (let i = 0; i < numberOfOrders; i++) {
        const spreadStep = spreadDecimal / numberOfOrders;
        const priceOffset = spreadStep * (i + 0.5);

        let orderPrice: number;
        if (side === "bid") {
            orderPrice = referencePrice * (1 - priceOffset);
        } else {
            orderPrice = referencePrice * (1 + priceOffset);
        }

        orders.push({
            price: orderPrice,
            quoteAmount: quoteAmountPerOrder
        });
    }

    return orders;
}

/**
 * Log order summary
 */
function logOrderSummary(
    symbol: string,
    bidOrders: SpreadOrder[],
    askOrders: SpreadOrder[],
    currentPrice: number,
    spreadPercent: number
): void {
    const [baseSymbol, quoteSymbol] = symbol.split("/");

    console.log("\n" + "=".repeat(60));
    console.log("📊 ORDER SUMMARY");
    console.log("=".repeat(60));
    console.log(`Reference Price:   ${currentPrice.toFixed(8)}`);
    console.log(`Spread Range:      ${spreadPercent}% each side`);
    console.log("");

    // BID side summary
    const totalBidBase = bidOrders.reduce((sum, o) => sum + o.amount, 0);
    const totalBidQuote = bidOrders.reduce((sum, o) => sum + o.quoteValue, 0);
    console.log(`BID Side (${bidOrders.length} orders):`);
    console.log(`  Total Base:  ${totalBidBase.toFixed(8)} ${baseSymbol}`);
    console.log(`  Total Quote: ${totalBidQuote.toFixed(2)} ${quoteSymbol}`);
    if (bidOrders.length > 0) {
        const lowestBid = Math.min(...bidOrders.map((o) => o.price));
        const highestBid = Math.max(...bidOrders.map((o) => o.price));
        console.log(
            `  Price Range: ${lowestBid.toFixed(8)} - ${highestBid.toFixed(8)}`
        );
    }
    console.log("");

    // ASK side summary
    const totalAskBase = askOrders.reduce((sum, o) => sum + o.amount, 0);
    const totalAskQuote = askOrders.reduce((sum, o) => sum + o.quoteValue, 0);
    console.log(`ASK Side (${askOrders.length} orders):`);
    console.log(`  Total Base:  ${totalAskBase.toFixed(8)} ${baseSymbol}`);
    console.log(`  Total Quote: ${totalAskQuote.toFixed(2)} ${quoteSymbol}`);
    if (askOrders.length > 0) {
        const lowestAsk = Math.min(...askOrders.map((o) => o.price));
        const highestAsk = Math.max(...askOrders.map((o) => o.price));
        console.log(
            `  Price Range: ${lowestAsk.toFixed(8)} - ${highestAsk.toFixed(8)}`
        );
    }

    console.log("=".repeat(60) + "\n");
}

/**
 * Place spread orders on both sides
 */
export async function placeSpreadOrders(
    config: SpreadMMConfig
): Promise<SpreadMMResult> {
    const priceReference = config.priceReference || "mid";
    const exchange = initExchange(config.exchange);

    console.log(`🎯 Placing Spread Orders for ${config.symbol}`);
    console.log(
        `   BID Total: $${config.bidTotalQuoteAmount} | ASK Total: $${config.askTotalQuoteAmount}`
    );
    console.log(`   Spread: ${config.spreadPercent}% each side`);
    console.log(`   Orders per side: ${config.numberOfOrders}`);

    // Get current price
    const currentPrice = await getReferencePrice(
        exchange,
        config.symbol,
        priceReference
    );

    if (currentPrice === 0) {
        throw new Error("Unable to get reference price");
    }

    console.log(`\n📍 Reference Price: ${currentPrice.toFixed(8)}`);

    // Check balances
    const [baseSymbol, quoteSymbol] = config.symbol.split("/");
    let adjustedBidQuoteAmount = config.bidTotalQuoteAmount;
    let adjustedAskQuoteAmount = config.askTotalQuoteAmount;

    // Check quote balance for BID orders
    const quoteBalance = await account.getCurrencyBalance(exchange, quoteSymbol);
    console.log(`💰 Available ${quoteSymbol}: ${quoteBalance.free.toFixed(2)}`);
    if (quoteBalance.free < config.bidTotalQuoteAmount) {
        adjustedBidQuoteAmount = quoteBalance.free;
        console.log(
            `⚠️  Insufficient ${quoteSymbol} for BID! Adjusting to: $${adjustedBidQuoteAmount.toFixed(
                2
            )}`
        );
    }

    // Check base balance for ASK orders
    const baseBalance = await account.getCurrencyBalance(exchange, baseSymbol);
    const availableBaseValue = baseBalance.free * currentPrice;
    console.log(
        `💰 Available ${baseSymbol}: ${baseBalance.free.toFixed(
            8
        )} (~$${availableBaseValue.toFixed(2)} ${quoteSymbol})`
    );
    if (availableBaseValue < config.askTotalQuoteAmount) {
        adjustedAskQuoteAmount = availableBaseValue;
        console.log(
            `⚠️  Insufficient ${baseSymbol} for ASK! Adjusting to: $${adjustedAskQuoteAmount.toFixed(
                2
            )}`
        );
    }

    // Calculate order distributions
    const bidDistribution = calculateOrderDistribution(
        currentPrice,
        "bid",
        adjustedBidQuoteAmount,
        config.spreadPercent,
        config.numberOfOrders
    );

    const askDistribution = calculateOrderDistribution(
        currentPrice,
        "ask",
        adjustedAskQuoteAmount,
        config.spreadPercent,
        config.numberOfOrders
    );

    // Place BID orders
    const bidOrders: SpreadOrder[] = [];
    console.log(`\n📝 Placing ${config.numberOfOrders} BID orders:\n`);

    for (let i = 0; i < bidDistribution.length; i++) {
        const { price, quoteAmount } = bidDistribution[i];
        const baseAmount = quoteAmount / price;

        try {
            const order = await trading.createLimitOrder(
                exchange,
                config.symbol,
                "buy",
                baseAmount,
                price
            );

            bidOrders.push({
                id: order.id,
                side: "buy",
                price: price,
                amount: baseAmount,
                quoteValue: quoteAmount
            });

            const priceDeviation = (
                ((price - currentPrice) / currentPrice) *
                100
            ).toFixed(3);
            console.log(
                `   ✅ BID ${i + 1}/${config.numberOfOrders}: ` +
                `${baseAmount.toFixed(8)} @ ${price.toFixed(8)} ` +
                `(${priceDeviation}% | $${quoteAmount.toFixed(2)})`
            );
        } catch (error) {
            console.error(`   ❌ Failed to place BID order ${i + 1}:`, error);
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Place ASK orders
    const askOrders: SpreadOrder[] = [];
    console.log(`\n📝 Placing ${config.numberOfOrders} ASK orders:\n`);

    for (let i = 0; i < askDistribution.length; i++) {
        const { price, quoteAmount } = askDistribution[i];
        const baseAmount = quoteAmount / price;

        try {
            const order = await trading.createLimitOrder(
                exchange,
                config.symbol,
                "sell",
                baseAmount,
                price
            );

            askOrders.push({
                id: order.id,
                side: "sell",
                price: price,
                amount: baseAmount,
                quoteValue: quoteAmount
            });

            const priceDeviation = (
                ((price - currentPrice) / currentPrice) *
                100
            ).toFixed(3);
            console.log(
                `   ✅ ASK ${i + 1}/${config.numberOfOrders}: ` +
                `${baseAmount.toFixed(8)} @ ${price.toFixed(8)} ` +
                `(${priceDeviation}% | $${quoteAmount.toFixed(2)})`
            );
        } catch (error) {
            console.error(`   ❌ Failed to place ASK order ${i + 1}:`, error);
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Log summary
    logOrderSummary(
        config.symbol,
        bidOrders,
        askOrders,
        currentPrice,
        config.spreadPercent
    );

    return {
        config,
        currentPrice,
        bidOrders,
        askOrders,
        totalBidAmount: bidOrders.reduce((sum, o) => sum + o.quoteValue, 0),
        totalAskAmount: askOrders.reduce((sum, o) => sum + o.quoteValue, 0)
    };
}

/**
 * Cancel orders
 */
export async function cancelSpreadOrders(
    exchangeName: ExchangeName,
    symbol: string,
    orderIds?: string[]
): Promise<void> {
    const exchange = initExchange(exchangeName);

    console.log(`\n🗑️  Cancelling orders for ${symbol}...`);

    try {
        if (orderIds && orderIds.length > 0) {
            let cancelledCount = 0;
            let alreadyGoneCount = 0;

            for (const orderId of orderIds) {
                try {
                    await trading.cancelOrder(exchange, orderId, symbol);
                    cancelledCount++;
                    console.log(`   ✅ Cancelled order ${orderId}`);
                } catch (error: any) {
                    if (
                        error.message?.includes("ORDER_005") ||
                        error.message?.includes("InvalidOrder")
                    ) {
                        alreadyGoneCount++;
                    } else {
                        console.error(
                            `   ❌ Failed to cancel order ${orderId}:`,
                            error.message
                        );
                    }
                }
            }

            console.log(
                `   ℹ️  Summary: ${cancelledCount} cancelled, ${alreadyGoneCount} already filled/gone`
            );
        } else {
            await trading.cancelAllOrders(exchange, symbol);
            console.log("   ✅ All orders cancelled");
        }
    } catch (error) {
        console.error("   ❌ Error cancelling orders:", error);
        throw error;
    }
}

/**
 * Check filled orders
 */
export async function checkFilledOrders(
    exchangeName: ExchangeName,
    symbol: string,
    placedOrderIds: string[]
): Promise<{ filled: any[]; open: any[] }> {
    const exchange = initExchange(exchangeName);

    const openOrders = await trading.fetchOpenOrders(exchange, symbol);
    const openOrderIds = new Set(openOrders.map((o: any) => o.id));

    const filled: any[] = [];
    const open: any[] = [];

    for (const orderId of placedOrderIds) {
        if (openOrderIds.has(orderId)) {
            const order = openOrders.find((o: any) => o.id === orderId);
            if (order) open.push(order);
        } else {
            try {
                const order = await trading.fetchOrder(exchange, orderId, symbol);
                if (order.status === "closed") {
                    filled.push(order);
                    console.log(
                        `✅ Order filled: ${orderId} at ${order.price} (${order.side})`
                    );
                }
            } catch (error) {
                // Silent - order might be too old to fetch
            }
        }
    }

    return { filled, open };
}

/**
 * Start monitoring bot
 */
export async function startMonitoring(
    config: SpreadMMConfig = botConfig
): Promise<void> {
    console.log("🚀 Starting Spread Market Maker Bot...\n");

    // Check initial balances
    const exchange = initExchange(config.exchange);
    const [baseSymbol, quoteSymbol] = config.symbol.split("/");

    console.log("💰 Checking account balances...\n");

    try {
        const baseBalance = await account.getCurrencyBalance(exchange, baseSymbol);
        console.log(
            `   ${baseSymbol}: ${baseBalance.free.toFixed(
                8
            )} (free) | ${baseBalance.total.toFixed(8)} (total)`
        );

        const quoteBalance = await account.getCurrencyBalance(
            exchange,
            quoteSymbol
        );
        console.log(
            `   ${quoteSymbol}: ${quoteBalance.free.toFixed(
                2
            )} (free) | ${quoteBalance.total.toFixed(2)} (total)`
        );

        if (baseBalance.free === 0 && quoteBalance.free === 0) {
            console.warn(`⚠️  Warning: No balance available on either side`);
        }
    } catch (error) {
        console.error("⚠️  Error checking balance:", error);
    }

    console.log("");

    // Place initial orders
    let activeOrderIds: string[] = [];

    try {
        const result = await placeSpreadOrders(config);
        activeOrderIds = [
            ...result.bidOrders.map((o) => o.id),
            ...result.askOrders.map((o) => o.id)
        ];
    } catch (error) {
        console.error("❌ Error placing initial orders:", error);
        console.log("⚠️  Continuing anyway...\n");
    }

    console.log(`\n🔄 Monitoring started - checking every 1 second...\n`);

    // Monitor loop
    const monitorInterval = setInterval(async () => {
        try {
            if (activeOrderIds.length === 0) {
                // No active orders, place new ones
                console.log(`\n🔄 No active orders detected. Placing new orders...\n`);

                try {
                    const result = await placeSpreadOrders(config);
                    activeOrderIds = [
                        ...result.bidOrders.map((o) => o.id),
                        ...result.askOrders.map((o) => o.id)
                    ];
                } catch (error) {
                    console.error("❌ Error placing new orders:", error);
                    console.log("⏳ Will retry in next cycle...\n");
                }
                return;
            }

            const { filled, open } = await checkFilledOrders(
                config.exchange,
                config.symbol,
                activeOrderIds
            );

            if (filled.length > 0) {
                console.log(`\n📦 ${filled.length} order(s) filled!`);

                // Separate open orders by side
                const bidOrders = open.filter((o: any) => o.side === 'buy');
                const askOrders = open.filter((o: any) => o.side === 'sell');

                console.log(`📊 Open: ${bidOrders.length} BID | ${askOrders.length} ASK`);

                let shouldCancelAll = false;

                // If all BID orders are filled, cancel remaining ASK orders
                if (bidOrders.length === 0 && askOrders.length > 0) {
                    console.log(`\n⚠️  All BID orders filled! Cancelling ${askOrders.length} ASK order(s)...`);
                    try {
                        const askIds = askOrders.map((o: any) => o.id);
                        await cancelSpreadOrders(config.exchange, config.symbol, askIds);
                        console.log(`✅ Cancelled all ASK orders\n`);
                        shouldCancelAll = true;
                    } catch (error) {
                        console.error("❌ Error cancelling ASK orders:", error);
                    }
                }

                // If all ASK orders are filled, cancel remaining BID orders
                if (askOrders.length === 0 && bidOrders.length > 0) {
                    console.log(`\n⚠️  All ASK orders filled! Cancelling ${bidOrders.length} BID order(s)...`);
                    try {
                        const bidIds = bidOrders.map((o: any) => o.id);
                        await cancelSpreadOrders(config.exchange, config.symbol, bidIds);
                        console.log(`✅ Cancelled all BID orders\n`);
                        shouldCancelAll = true;
                    } catch (error) {
                        console.error("❌ Error cancelling BID orders:", error);
                    }
                }

                // Clear active orders and place new ones in next cycle
                activeOrderIds = [];
                console.log(`🔄 Will place fresh orders in next cycle...\n`);
            } else {
                // Show heartbeat every 10 seconds when no fills
                const now = new Date();
                if (now.getSeconds() % 10 === 0) {
                    console.log(
                        `💓 [${now.toLocaleTimeString()}] Monitoring... ${open.length
                        } orders active`
                    );
                }
            }
        } catch (error) {
            console.error("❌ Error during monitoring:", error);
            console.log("⚠️  Continuing...\n");
        }
    }, 1000); // Check every 1 second

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
        console.log("\n\n🛑 Shutting down...");
        clearInterval(monitorInterval);

        console.log(`\n📊 Current open orders: ${activeOrderIds.length}`);

        if (activeOrderIds.length > 0) {
            try {
                await cancelSpreadOrders(
                    config.exchange,
                    config.symbol,
                    activeOrderIds
                );
            } catch (error) {
                console.error("❌ Error cancelling orders:", error);
            }
        }

        console.log("✅ Bot stopped\n");
        process.exit(0);
    });
}

/**
 * Run the bot
 */
export async function runBot() {
    await startMonitoring(botConfig);
}

// Auto-run when executed directly
if (require.main === module) {
    runBot().catch(console.error);
}
