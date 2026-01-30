/**
 * Market Making Strategy - Two-Sided Market Maker
 * Places orders on BOTH sides (BID and ASK) simultaneously
 * When ANY order fills on either side, ALL orders on BOTH sides are replaced
 */

import * as ccxt from "ccxt";
import chalk from "chalk";
import * as account from "../account";
import { initExchange, type ExchangeName } from "../exchange";
import * as marketData from "../market-data";
import * as trading from "../trading";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface BothSideMMConfig {
    exchange: ExchangeName;
    symbol: string;
    bidTotalQuoteAmount: number; // Total amount for BID orders in quote currency
    askTotalQuoteAmount: number; // Total amount for ASK orders in quote currency
    spreadPercent: number; // Spread percentage (e.g., 20 for 20%)
    numberOfOrders: number; // Number of orders per side
    priceReference?: "first_ask" | "first_bid" | "mid" | "best";
    driftThresholdPercent?: number;
    monitorIntervalSeconds?: number;
}

interface OrderInfo {
    id: string;
    side: "buy" | "sell";
    price: number;
    amount: number;
    quoteValue: number;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const botConfig: BothSideMMConfig = {
    exchange: (process.env.EXCHANGE as ExchangeName) || "xt",
    symbol: process.env.SYMBOL || "ORBD/USDT",
    bidTotalQuoteAmount: parseFloat(
        process.env.BID_TOTAL_QUOTE_AMOUNT ||
        process.env.TOTAL_QUOTE_AMOUNT ||
        "5.5"
    ),
    askTotalQuoteAmount: parseFloat(
        process.env.ASK_TOTAL_QUOTE_AMOUNT ||
        process.env.TOTAL_QUOTE_AMOUNT ||
        "5.5"
    ),
    spreadPercent: parseFloat(process.env.SPREAD_PERCENT || "20"),
    numberOfOrders: parseInt(process.env.NUMBER_OF_ORDERS || "20"),
    priceReference:
        (process.env.PRICE_REFERENCE as
            | "first_ask"
            | "first_bid"
            | "mid"
            | "best") || "mid",
    driftThresholdPercent: parseFloat(
        process.env.DRIFT_THRESHOLD_PERCENT || process.env.SPREAD_PERCENT || "20"
    ),
    monitorIntervalSeconds: parseFloat(
        process.env.MONITOR_INTERVAL_SECONDS || "1"
    ),
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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
            quoteAmount: quoteAmountPerOrder,
        });
    }

    return orders;
}

/**
 * Place orders on one side
 */
async function placeOrdersOneSide(
    exchange: ccxt.Exchange,
    config: BothSideMMConfig,
    side: "bid" | "ask",
    referencePrice: number,
    totalAmount: number,
    market: any
): Promise<OrderInfo[]> {
    const color = side === "bid" ? chalk.green : chalk.red;
    const orderSide = side === "bid" ? "buy" : "sell";
    const [baseSymbol, quoteSymbol] = config.symbol.split("/");

    console.log(color(`\n📊 Placing ${side.toUpperCase()} orders...`));

    // Get market constraints
    const amountPrecision = market?.precision?.amount || 2;
    const pricePrecision = market?.precision?.price || 4;
    const minCost = market?.limits?.cost?.min || 1;
    const minAmount = market?.limits?.amount?.min || 0;
    const minPrice = market?.limits?.price?.min || 0.0001;

    const amountDecimals =
        amountPrecision < 1 ? -Math.log10(amountPrecision) : amountPrecision;
    const priceDecimals =
        pricePrecision < 1 ? -Math.log10(pricePrecision) : pricePrecision;
    const amountTickSize =
        amountPrecision < 1 ? amountPrecision : Math.pow(10, -amountPrecision);
    const priceTickSize =
        pricePrecision < 1 ? pricePrecision : Math.pow(10, -pricePrecision);

    // Calculate order distribution
    const orderDistribution = calculateOrderDistribution(
        referencePrice,
        side,
        totalAmount,
        config.spreadPercent,
        config.numberOfOrders
    );

    // Place orders sequentially with delay to avoid rate limits
    const placedOrders: OrderInfo[] = [];
    const delayBetweenOrders = 50; // 100ms delay between orders (10 orders/second max)

    for (let i = 0; i < orderDistribution.length; i++) {
        const orderData = orderDistribution[i];
        const { price: rawPrice, quoteAmount } = orderData;
        const rawBaseAmount = quoteAmount / rawPrice;

        // Round to exchange precision
        let price = Math.round(rawPrice / priceTickSize) * priceTickSize;
        price = parseFloat(price.toFixed(priceDecimals));
        price = Math.max(price, minPrice);

        let baseAmount =
            Math.round(rawBaseAmount / amountTickSize) * amountTickSize;
        baseAmount = parseFloat(baseAmount.toFixed(amountDecimals));

        // Check minimum amount
        if (baseAmount < minAmount) {
            console.log(
                color(
                    `   ⚠️  Order ${i + 1}: Skipped - amount ${baseAmount.toFixed(
                        amountDecimals
                    )} below minimum ${minAmount}`
                )
            );
            continue;
        }

        const actualCost = baseAmount * price;

        try {
            const order = await trading.createLimitOrder(
                exchange,
                config.symbol,
                orderSide,
                baseAmount,
                price
            );

            const priceDeviation = (
                ((price - referencePrice) / referencePrice) *
                100
            ).toFixed(3);

            console.log(
                color(
                    `   ✅ Order ${i + 1}: ${baseAmount.toFixed(
                        4
                    )} ${baseSymbol} @ ${price.toFixed(
                        8
                    )} (${priceDeviation}% from ref)`
                )
            );

            placedOrders.push({
                id: order.id,
                side: orderSide,
                price: price,
                amount: baseAmount,
                quoteValue: actualCost,
            });

            // Add delay between orders to avoid rate limits
            if (i < orderDistribution.length - 1) {
                await new Promise(resolve => setTimeout(resolve, delayBetweenOrders));
            }
        } catch (error: any) {
            console.error(color(`   ❌ Order ${i + 1} failed:`), error.message);

            // If rate limited, wait longer before next order
            if (error.message?.includes("429") || error.message?.includes("RateLimitExceeded")) {
                console.log(color(`   ⏳ Rate limited - waiting 2 seconds...`));
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    }

    console.log(
        color(`✅ Placed ${placedOrders.length}/${config.numberOfOrders} ${side.toUpperCase()} orders`)
    );

    return placedOrders;
}

/**
 * Place orders on both sides in parallel
 */
async function placeBothSides(
    exchange: ccxt.Exchange,
    config: BothSideMMConfig,
    market: any
): Promise<{ bidOrders: OrderInfo[]; askOrders: OrderInfo[] }> {
    console.log(chalk.cyan(`\n${"=".repeat(60)}`));
    console.log(chalk.cyan(`📤 PLACING ORDERS ON BOTH SIDES (WITH RATE LIMITING)`));
    console.log(chalk.cyan(`${"=".repeat(60)}`));

    // Get reference price
    const referencePrice = await getReferencePrice(
        exchange,
        config.symbol,
        config.priceReference || "mid"
    );

    console.log(
        chalk.white(`📍 Reference Price: ${referencePrice.toFixed(8)}\n`)
    );

    // Place BID orders first
    console.log(chalk.green(`📊 Placing BID orders (sequential with delays)...`));
    const bidOrders = await placeOrdersOneSide(
        exchange,
        config,
        "bid",
        referencePrice,
        config.bidTotalQuoteAmount,
        market
    );

    // Add delay between sides
    await new Promise(resolve => setTimeout(resolve, 500));

    // Place ASK orders second
    console.log(chalk.red(`\n📊 Placing ASK orders (sequential with delays)...`));
    const askOrders = await placeOrdersOneSide(
        exchange,
        config,
        "ask",
        referencePrice,
        config.askTotalQuoteAmount,
        market
    );

    console.log(chalk.cyan(`\n${"=".repeat(60)}`));
    console.log(
        chalk.cyan(
            `✅ BOTH SIDES READY - Total: ${bidOrders.length + askOrders.length
            } orders`
        )
    );
    console.log(chalk.cyan(`${"=".repeat(60)}\n`));

    return { bidOrders, askOrders };
}

/**
 * Cancel all orders
 */
async function cancelAllOrders(
    exchange: ccxt.Exchange,
    symbol: string,
    orderIds: string[]
): Promise<void> {
    if (orderIds.length === 0) return;

    console.log(chalk.yellow(`\n🗑️  Cancelling ${orderIds.length} orders...`));

    try {
        await exchange.cancelAllOrders(symbol);
        console.log(chalk.yellow(`✅ Cancelled all orders\n`));
    } catch (error: any) {
        console.error(chalk.red(`❌ Error cancelling orders:`), error.message);
    }
}

/**
 * Check for filled orders
 */
async function checkForFills(
    exchange: ccxt.Exchange,
    symbol: string,
    bidOrderIds: string[],
    askOrderIds: string[]
): Promise<{ bidFilled: string[]; askFilled: string[] }> {
    const allOpenOrders = await trading.fetchOpenOrders(exchange, symbol);
    const openOrderIds = new Set(allOpenOrders.map((o: any) => o.id));

    const bidFilled = bidOrderIds.filter((id) => !openOrderIds.has(id));
    const askFilled = askOrderIds.filter((id) => !openOrderIds.has(id));

    return { bidFilled, askFilled };
}

/**
 * Log fill notification
 */
function logFillNotification(
    bidFilled: string[],
    askFilled: string[]
): void {
    if (bidFilled.length === 0 && askFilled.length === 0) return;

    console.log(chalk.yellow(`\n${"=".repeat(60)}`));
    console.log(chalk.yellow.bold(`💰 FILL DETECTED!`));
    console.log(chalk.yellow(`${"=".repeat(60)}`));

    if (bidFilled.length > 0) {
        console.log(
            chalk.green(
                `✅ BID: ${bidFilled.length} order(s) filled - ${bidFilled
                    .map((id) => id.substring(0, 12))
                    .join(", ")}`
            )
        );
    }

    if (askFilled.length > 0) {
        console.log(
            chalk.red(
                `✅ ASK: ${askFilled.length} order(s) filled - ${askFilled
                    .map((id) => id.substring(0, 12))
                    .join(", ")}`
            )
        );
    }

    console.log(chalk.yellow(`🔄 Replacing ALL orders on BOTH sides...`));
    console.log(chalk.yellow(`${"=".repeat(60)}\n`));
}

// ============================================================================
// MAIN BOT LOGIC
// ============================================================================

/**
 * Start the two-sided market maker bot
 */
export async function startBot(
    config: BothSideMMConfig = botConfig
): Promise<void> {
    console.log(chalk.cyan.bold(`\n🚀 Starting Two-Sided Market Maker Bot...\n`));

    // Initialize exchange
    const exchange = initExchange(config.exchange);

    // Load markets
    console.log(chalk.cyan(`📥 Loading market data...`));
    const markets = await exchange.loadMarkets();
    const market = markets[config.symbol];
    console.log(chalk.cyan(`✅ Market data loaded\n`));

    // Track active orders
    let activeBidOrderIds: string[] = [];
    let activeAskOrderIds: string[] = [];
    let expectedBidCount = 0; // Track ACTUAL number of BID orders placed
    let expectedAskCount = 0; // Track ACTUAL number of ASK orders placed

    // Place initial orders
    console.log(chalk.cyan(`📤 Placing initial orders...\n`));
    const initial = await placeBothSides(exchange, config, market);
    activeBidOrderIds = initial.bidOrders.map((o) => o.id);
    activeAskOrderIds = initial.askOrders.map((o) => o.id);
    expectedBidCount = initial.bidOrders.length; // Track actual count
    expectedAskCount = initial.askOrders.length; // Track actual count

    const intervalSeconds = config.monitorIntervalSeconds || 1;
    console.log(
        chalk.cyan(
            `🔄 Monitoring started - checking every ${intervalSeconds}s...\n`
        )
    );

    let cycleCount = 0;
    const heartbeatInterval = Math.ceil(10 / intervalSeconds);

    // Lock to prevent concurrent operations
    let isProcessing = false;

    // Monitoring loop
    const monitorInterval = setInterval(async () => {
        cycleCount++;

        // Skip if already processing
        if (isProcessing) {
            console.log(chalk.gray(`⏭  Skipping cycle - busy processing...`));
            return;
        }

        try {
            isProcessing = true;

            // Check for fills
            const { bidFilled, askFilled } = await checkForFills(
                exchange,
                config.symbol,
                activeBidOrderIds,
                activeAskOrderIds
            );

            // If ANY order filled, replace ALL orders
            if (bidFilled.length > 0 || askFilled.length > 0) {
                logFillNotification(bidFilled, askFilled);

                // Cancel all remaining orders
                await exchange.cancelAllOrders(config.symbol);

                // Wait for cancellations to settle
                await new Promise((resolve) => setTimeout(resolve, 1500));

                // Check if both sides are clear
                const recheckOrders = await trading.fetchOpenOrders(
                    exchange,
                    config.symbol
                );

                if (recheckOrders.length === 0) {
                    console.log(
                        chalk.green(`✅ Both sides clear - placing fresh orders...\n`)
                    );

                    // Place new orders on both sides
                    const newOrders = await placeBothSides(
                        exchange,
                        config,
                        market
                    );
                    activeBidOrderIds = newOrders.bidOrders.map((o) => o.id);
                    activeAskOrderIds = newOrders.askOrders.map((o) => o.id);
                    expectedBidCount = newOrders.bidOrders.length; // Update expected counts
                    expectedAskCount = newOrders.askOrders.length;
                } else {
                    console.log(
                        chalk.yellow(
                            `⏸  ${recheckOrders.length} orders still present - will retry next cycle\n`
                        )
                    );
                    // Update tracking with remaining orders
                    const bidOrders = recheckOrders.filter(
                        (o: any) => o.side === "buy"
                    );
                    const askOrders = recheckOrders.filter(
                        (o: any) => o.side === "sell"
                    );
                    activeBidOrderIds = bidOrders.map((o: any) => o.id);
                    activeAskOrderIds = askOrders.map((o: any) => o.id);
                }

                return;
            }

            // Check if any side is empty
            const allOpenOrders = await trading.fetchOpenOrders(
                exchange,
                config.symbol
            );
            const ourBidOrders = allOpenOrders.filter(
                (o: any) =>
                    o.side === "buy" && activeBidOrderIds.includes(o.id)
            );
            const ourAskOrders = allOpenOrders.filter(
                (o: any) =>
                    o.side === "sell" && activeAskOrderIds.includes(o.id)
            );

            if (ourBidOrders.length === 0 || ourAskOrders.length === 0) {
                console.log(
                    chalk.yellow(
                        `\n⚠️  Missing orders (${ourBidOrders.length} BID, ${ourAskOrders.length} ASK) - refreshing...\n`
                    )
                );

                await cancelAllOrders(exchange, config.symbol, [
                    ...activeBidOrderIds,
                    ...activeAskOrderIds,
                ]);
                await new Promise((resolve) => setTimeout(resolve, 500));

                const newOrders = await placeBothSides(exchange, config, market);
                activeBidOrderIds = newOrders.bidOrders.map((o) => o.id);
                activeAskOrderIds = newOrders.askOrders.map((o) => o.id);
                expectedBidCount = newOrders.bidOrders.length; // Update expected counts
                expectedAskCount = newOrders.askOrders.length;

                return;
            }

            // Check if either side has fewer orders than expected (based on actual placement)
            if (ourBidOrders.length < expectedBidCount || ourAskOrders.length < expectedAskCount) {
                console.log(
                    chalk.yellow(
                        `\n⚠️  Order count mismatch (${ourBidOrders.length}/${expectedBidCount} BID, ${ourAskOrders.length}/${expectedAskCount} ASK) - refreshing...\n`
                    )
                );

                await cancelAllOrders(exchange, config.symbol, [
                    ...activeBidOrderIds,
                    ...activeAskOrderIds,
                ]);

                await new Promise((resolve) => setTimeout(resolve, 500));

                const newOrders = await placeBothSides(exchange, config, market);
                activeBidOrderIds = newOrders.bidOrders.map((o) => o.id);
                activeAskOrderIds = newOrders.askOrders.map((o) => o.id);
                expectedBidCount = newOrders.bidOrders.length; // Update expected counts
                expectedAskCount = newOrders.askOrders.length;

                return;
            }

            // Heartbeat
            if (cycleCount % heartbeatInterval === 0) {
                const now = new Date();
                console.log(
                    chalk.cyan(
                        `💓 [${now.toLocaleTimeString()}] Monitoring... ${ourBidOrders.length
                        }/${expectedBidCount} BID + ${ourAskOrders.length}/${expectedAskCount} ASK orders active`
                    )
                );
            }
        } catch (error) {
            console.error(chalk.red(`❌ Error in monitoring loop:`), error);
            console.log("⚠️  Continuing...\n");
        } finally {
            // Always release the lock
            isProcessing = false;
        }
    }, intervalSeconds * 1000);

    // Graceful shutdown
    process.on("SIGINT", async () => {
        console.log(chalk.yellow(`\n\n🛑 Shutting down...`));
        clearInterval(monitorInterval);

        console.log(
            chalk.yellow(
                `\n📊 Cancelling ${activeBidOrderIds.length
                } BID + ${activeAskOrderIds.length} ASK orders...`
            )
        );

        try {
            await exchange.cancelAllOrders(config.symbol);
            console.log(chalk.green(`✅ All orders cancelled`));
        } catch (error) {
            console.error(chalk.red(`❌ Error cancelling orders:`), error);
        }

        console.log(chalk.green(`✅ Bot stopped\n`));
        process.exit(0);
    });
}

/**
 * Run the bot
 */
export async function runBot() {
    try {
        console.log("\n" + "=".repeat(60));
        console.log(chalk.cyan.bold("🤖 TWO-SIDED MARKET MAKER BOT"));
        console.log("=".repeat(60));
        console.log(`Exchange:         ${botConfig.exchange.toUpperCase()}`);
        console.log(`Symbol:           ${botConfig.symbol}`);
        console.log(
            chalk.green(`BID Amount:       $${botConfig.bidTotalQuoteAmount}`)
        );
        console.log(
            chalk.red(`ASK Amount:       $${botConfig.askTotalQuoteAmount}`)
        );
        console.log(`Spread:           ${botConfig.spreadPercent}%`);
        console.log(`Orders per side:  ${botConfig.numberOfOrders}`);
        console.log(`Price Reference:  ${botConfig.priceReference || "mid"}`);
        console.log(
            `Drift Threshold:  ${botConfig.driftThresholdPercent ||
            botConfig.spreadPercent
            }%`
        );
        console.log(
            `Monitor Interval: ${botConfig.monitorIntervalSeconds || 1}s`
        );
        console.log("=".repeat(60) + "\n");

        await startBot(botConfig);
    } catch (error) {
        console.error("❌ Bot failed to start:", error);
        process.exit(1);
    }
}

// Auto-run when executed directly
if (require.main === module) {
    runBot().catch(console.error);
}
