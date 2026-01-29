/**
 * Market Making Strategy - Mono Side (One-Sided)
 * Functional approach - Places orders on only one side (bid OR ask)
 * User specifies total amount in quote currency to be distributed across multiple orders
 */

import * as ccxt from "ccxt";
import chalk from "chalk";
import * as account from "../account";
import { initExchange, type ExchangeName } from "../exchange";
import * as marketData from "../market-data";
import * as trading from "../trading";

/**
 * Get color function based on side
 */
const getColor = (side: "bid" | "ask") =>
    side === "bid" ? chalk.green : chalk.red;

/**
 * Log trade fill to console and optionally to file
 */
function logTradeFill(
    side: "bid" | "ask",
    filledOrderIds: string[],
    timestamp: Date = new Date()
): void {
    const color = getColor(side);
    const logEntry = {
        timestamp: timestamp.toISOString(),
        side: side.toUpperCase(),
        filledOrders: filledOrderIds.length,
        orderIds: filledOrderIds
    };

    console.log(color("\n" + "=".repeat(60)));
    console.log(color(`💰 TRADE FILL DETECTED - ${side.toUpperCase()}`));
    console.log(color("=".repeat(60)));
    console.log(`🕐 Time:     ${timestamp.toLocaleString()}`);
    console.log(`📊 Filled:   ${filledOrderIds.length} order(s)`);
    console.log(
        `🆔 IDs:      ${filledOrderIds
            .map((id) => id.substring(0, 12))
            .join(", ")}...`
    );
    console.log(color("=".repeat(60) + "\n"));

    // Log to file (append mode) - optional, uncomment if needed
    // const fs = require('fs');
    // fs.appendFileSync('trades.log', JSON.stringify(logEntry) + '\n');
}

/**
 * Send notification (extensible for Telegram/Discord/Email)
 */
function sendNotification(
    message: string,
    level: "info" | "warning" | "error" | "success" = "info"
): void {
    const icons = {
        info: "ℹ️",
        warning: "⚠️",
        error: "❌",
        success: "✅"
    };

    const timestamp = new Date().toLocaleTimeString();
    console.log(`${icons[level]} [${timestamp}] ${message}`);

    // Add your notification service here:
    // - Telegram: await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, ...)
    // - Discord: await fetch(DISCORD_WEBHOOK_URL, ...)
    // - Email: await nodemailer.sendMail(...)
}

const botConfig: MonoSideMMConfig = {
    exchange: (process.env.EXCHANGE as ExchangeName) || "xt",
    symbol: process.env.SYMBOL || "ORBD/USDT",
    side: (process.env.SIDE as "bid" | "ask") || "ask",
    totalQuoteAmount: parseFloat(process.env.TOTAL_QUOTE_AMOUNT || "5.5"),
    spreadPercent: parseFloat(process.env.SPREAD_PERCENT || "20"),
    numberOfOrders: parseInt(process.env.NUMBER_OF_ORDERS || "20"),
    priceReference:
        (process.env.PRICE_REFERENCE as
            | "first_ask"
            | "first_bid"
            | "mid"
            | "best") || "first_ask",
    driftThresholdPercent: parseFloat(
        process.env.DRIFT_THRESHOLD_PERCENT || process.env.SPREAD_PERCENT || "20"
    ),
    monitorIntervalSeconds: parseFloat(
        process.env.MONITOR_INTERVAL_SECONDS || "1"
    )
};

export interface MonoSideMMConfig {
    exchange: ExchangeName;
    symbol: string;
    side: "bid" | "ask"; // Which side to place orders (buy or sell)
    totalQuoteAmount: number; // Total amount in quote currency (e.g., 50 USDT)
    spreadPercent: number; // Spread percentage (e.g., 0.5 for 0.5%)
    numberOfOrders: number; // Number of orders to distribute (e.g., 10)
    priceReference?: "first_ask" | "first_bid" | "mid" | "best"; // Price reference: first_ask (lowest ask), first_bid (highest bid), mid (average), best (auto-select based on side)
    driftThresholdPercent?: number; // Max allowed price drift before refreshing orders (default: spreadPercent)
    monitorIntervalSeconds?: number; // How often to check orders in seconds (default: 1)
}

export interface MonoSideOrder {
    id: string;
    side: "buy" | "sell";
    price: number;
    amount: number;
    quoteValue: number;
}

export interface MonoSideMMResult {
    config: MonoSideMMConfig;
    currentPrice: number;
    placedOrders: MonoSideOrder[];
    totalBaseAmount: number;
    totalQuoteAmount: number;
}

/**
 * Get current reference price
 */
async function getReferencePrice(
    exchange: ccxt.Exchange,
    symbol: string,
    side: "bid" | "ask",
    priceReference: "first_ask" | "first_bid" | "mid" | "best"
): Promise<number> {
    const ticker = await marketData.fetchTicker(exchange, symbol);

    switch (priceReference) {
        case "first_ask":
            // Always use lowest ask price
            return ticker.ask || ticker.last || 0;

        case "first_bid":
            // Always use highest bid price
            return ticker.bid || ticker.last || 0;

        case "mid":
            // Use mid price (average of bid and ask)
            if (ticker.bid && ticker.ask) {
                return (ticker.bid + ticker.ask) / 2;
            }
            return ticker.last || 0;

        case "best":
            // Auto-select based on order side
            if (side === "bid") {
                return ticker.bid || ticker.last || 0; // Use highest bid for buying
            } else {
                return ticker.ask || ticker.last || 0; // Use lowest ask for selling
            }

        default:
            return ticker.last || 0;
    }
}

/**
 * Calculate order distribution across spread
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
 * Prepare order parameters with proper rounding and validation
 */
function prepareOrder(
    config: MonoSideMMConfig,
    orderData: { price: number; quoteAmount: number },
    orderIndex: number,
    amountDecimals: number,
    priceDecimals: number,
    amountTickSize: number,
    priceTickSize: number,
    minPrice: number,
    minCost: number,
    minAmount: number
): {
    price: number;
    baseAmount: number;
    actualCost: number;
    orderSide: "buy" | "sell";
} | null {
    const [baseSymbol, quoteSymbol] = config.symbol.split("/");
    const { price: rawPrice, quoteAmount } = orderData;
    const rawBaseAmount = quoteAmount / rawPrice;

    // Round to exchange precision with proper tick size
    let price = Math.round(rawPrice / priceTickSize) * priceTickSize;
    price = parseFloat(price.toFixed(priceDecimals));

    // Ensure price meets minimum
    if (price < minPrice) {
        price = minPrice;
    }

    // Round amount to tick size as well
    let baseAmount = Math.round(rawBaseAmount / amountTickSize) * amountTickSize;
    baseAmount = parseFloat(baseAmount.toFixed(amountDecimals));

    // Calculate actual cost
    const actualCost = baseAmount * price;

    console.log(
        `   🔍 Order ${orderIndex + 1
        } debug: amount=${baseAmount}, price=${price}, cost=${actualCost.toFixed(
            2
        )}`
    );

    // // Check if order meets minimum value requirement
    // if (quoteAmount < minCost) {
    //     console.log(
    //         `   ⚠️  Order ${orderIndex + 1}/${config.numberOfOrders}: ` +
    //         `Skipped - value $${quoteAmount.toFixed(2)} below minimum $${minCost.toFixed(2)}`
    //     );
    //     return null;
    // }

    // Check minimum amount
    if (baseAmount < minAmount) {
        console.log(
            `   ⚠️  Order ${orderIndex + 1}/${config.numberOfOrders}: ` +
            `Skipped - amount ${baseAmount.toFixed(
                amountDecimals
            )} below minimum ${minAmount}`
        );
        return null;
    }

    const orderSide = config.side === "bid" ? "buy" : "sell";

    return {
        price,
        baseAmount,
        actualCost,
        orderSide
    };
}

/**
 * Place a single order on the exchange
 */
async function placeOrder(
    exchange: ccxt.Exchange,
    config: MonoSideMMConfig,
    orderParams: {
        price: number;
        baseAmount: number;
        actualCost: number;
        orderSide: "buy" | "sell";
    },
    orderIndex: number,
    currentPrice: number,
    quoteAmount: number
): Promise<MonoSideOrder | null> {
    const [baseSymbol, quoteSymbol] = config.symbol.split("/");
    const { price, baseAmount, actualCost, orderSide } = orderParams;

    console.log(
        `   📤 Preparing order ${orderIndex + 1}: ` +
        `${baseAmount} ${baseSymbol} @ ${price} ($${actualCost.toFixed(2)})`
    );

    try {
        const order = await trading.createLimitOrder(
            exchange,
            config.symbol,
            orderSide,
            baseAmount,
            price
        );

        const priceDeviation = (
            ((price - currentPrice) / currentPrice) *
            100
        ).toFixed(3);
        const color = getColor(config.side);
        const [baseSymbol, quoteSymbol] = config.symbol.split("/");

        console.log(
            color(`   ✅ Order ${orderIndex + 1} Placed [${config.side.toUpperCase()}]:`)
        );
        console.log(color(`      ID: ${order.id.substring(0, 16)}...`));
        console.log(color(`      Price: ${price.toFixed(8)} ${quoteSymbol}`));
        console.log(color(`      Size: ${baseAmount.toFixed(8)} ${baseSymbol}`));
        console.log(color(`      Value: $${quoteAmount.toFixed(2)} ${quoteSymbol}`));
        console.log(color(`      Deviation: ${priceDeviation}% from reference\n`));

        return {
            id: order.id,
            side: orderSide,
            price: price,
            amount: baseAmount,
            quoteValue: quoteAmount
        };
    } catch (error: any) {
        console.error(
            `   ❌ Failed order ${orderIndex + 1}:`,
            error.message || error
        );
        return null;
    }
}

/**
 * Prepare and place a single order with proper rounding and validation
 */
async function prepareAndPlaceOrder(
    exchange: ccxt.Exchange,
    config: MonoSideMMConfig,
    orderData: { price: number; quoteAmount: number },
    orderIndex: number,
    currentPrice: number,
    market: any,
    amountDecimals: number,
    priceDecimals: number,
    amountTickSize: number,
    priceTickSize: number,
    minPrice: number,
    minCost: number,
    minAmount: number
): Promise<MonoSideOrder | null> {
    // Prepare order parameters
    const orderParams = prepareOrder(
        config,
        orderData,
        orderIndex,
        amountDecimals,
        priceDecimals,
        amountTickSize,
        priceTickSize,
        minPrice,
        minCost,
        minAmount
    );

    // If preparation failed (validation errors), return null
    if (!orderParams) {
        return null;
    }

    // Place the order
    return await placeOrder(
        exchange,
        config,
        orderParams,
        orderIndex,
        currentPrice,
        orderData.quoteAmount
    );
}

/**
 * Check balance and adjust totalQuoteAmount if necessary
 */
async function checkAndAdjustBalance(
    exchange: ccxt.Exchange,
    config: MonoSideMMConfig,
    currentPrice: number
): Promise<number> {
    const [baseSymbol, quoteSymbol] = config.symbol.split("/");
    let adjustedQuoteAmount = config.totalQuoteAmount;

    if (config.side === "ask") {
        // For selling, check base currency balance
        const baseBalance = await account.getCurrencyBalance(exchange, baseSymbol);
        const availableBaseValue = baseBalance.free * currentPrice; // Convert to quote currency value

        console.log(
            `💰 Available ${baseSymbol}: ${baseBalance.free.toFixed(
                8
            )} (~$${availableBaseValue.toFixed(2)} ${quoteSymbol})`
        );

        if (availableBaseValue < config.totalQuoteAmount) {
            adjustedQuoteAmount = availableBaseValue;
            console.log(
                `⚠️  Insufficient balance! Adjusting to available: $${adjustedQuoteAmount.toFixed(
                    2
                )} ${quoteSymbol}`
            );
        }
    } else {
        // For buying, check quote currency balance
        const quoteBalance = await account.getCurrencyBalance(
            exchange,
            quoteSymbol
        );

        console.log(`💰 Available ${quoteSymbol}: ${quoteBalance.free.toFixed(2)}`);

        if (quoteBalance.free < config.totalQuoteAmount) {
            adjustedQuoteAmount = quoteBalance.free;
            console.log(
                `⚠️  Insufficient balance! Adjusting to available: $${adjustedQuoteAmount.toFixed(
                    2
                )} ${quoteSymbol}`
            );
        }
    }

    if (adjustedQuoteAmount <= 0) {
        throw new Error(
            `Insufficient balance to place orders. Available: $${adjustedQuoteAmount.toFixed(
                2
            )}`
        );
    }

    return adjustedQuoteAmount;
}

/**
 * Log order summary
 */
function logOrderSummary(
    symbol: string,
    side: "bid" | "ask",
    placedOrders: MonoSideOrder[],
    totalBaseAmount: number,
    totalQuoteAmount: number,
    currentPrice: number,
    spreadPercent: number
): void {
    const [baseSymbol, quoteSymbol] = symbol.split("/");

    console.log("\n" + "=".repeat(60));
    console.log("📊 ORDER SUMMARY");
    console.log("=".repeat(60));
    console.log(`Side:              ${side.toUpperCase()}`);
    console.log(`Total Orders:      ${placedOrders.length}`);
    console.log(`Total Base Amount: ${totalBaseAmount.toFixed(8)} ${baseSymbol}`);
    console.log(
        `Total Quote Value: ${totalQuoteAmount.toFixed(2)} ${quoteSymbol}`
    );
    console.log(`Reference Price:   ${currentPrice.toFixed(8)}`);
    console.log(`Spread Range:      ${spreadPercent}%`);

    if (placedOrders.length > 0) {
        const firstOrder = placedOrders[0];
        const lastOrder = placedOrders[placedOrders.length - 1];
        console.log(
            `Price Range:       ${Math.min(firstOrder.price, lastOrder.price).toFixed(
                8
            )} - ${Math.max(firstOrder.price, lastOrder.price).toFixed(8)}`
        );
    }

    console.log("=".repeat(60) + "\n");
}

/**
 * Place mono-side orders
 */
export async function placeMonoSideOrders(
    config: MonoSideMMConfig,
    exchange?: ccxt.Exchange,
    cachedMarket?: any
): Promise<MonoSideMMResult> {
    const priceReference = config.priceReference || "mid";
    const exchangeInstance = exchange || initExchange(config.exchange);
    const [baseSymbol, quoteSymbol] = config.symbol.split("/");
    const color = getColor(config.side);

    // Get current price
    const currentPrice = await getReferencePrice(
        exchangeInstance,
        config.symbol,
        config.side,
        priceReference
    );

    if (currentPrice === 0) {
        throw new Error("Unable to get reference price");
    }

    console.log(color(`🎯 Placing Mono-Side Orders for ${config.symbol}`));
    console.log(color(`   Side: ${config.side.toUpperCase()}`));
    console.log(`   Total Amount: ${config.totalQuoteAmount} (quote currency)`);
    console.log(`   Spread: ${config.spreadPercent}%`);
    console.log(`   Number of Orders: ${config.numberOfOrders}`);
    console.log(`\n📍 Reference Price: ${currentPrice.toFixed(8)}`);

    // Check balance and adjust totalQuoteAmount if necessary
    const adjustedQuoteAmount = await checkAndAdjustBalance(
        exchangeInstance,
        config,
        currentPrice
    );

    // Calculate order distribution
    const orderDistribution = calculateOrderDistribution(
        currentPrice,
        config.side,
        adjustedQuoteAmount,
        config.spreadPercent,
        config.numberOfOrders
    );

    // Place orders
    const placedOrders: MonoSideOrder[] = [];
    let totalBaseAmount = 0;
    let totalQuoteAmount = 0;

    // Get market info for minimum order size (use cached if available)
    const market =
        cachedMarket || (await exchangeInstance.loadMarkets())[config.symbol];

    const minCost = market?.limits?.cost?.min || 1; // XT minimum is likely $5
    const minAmount = market?.limits?.amount?.min || 0;

    console.log(`ℹ️  Exchange limits:`);
    console.log(`   Min order value: $${minCost.toFixed(2)}`);
    console.log(`   Min amount: ${minAmount} ${baseSymbol}`);
    console.log(
        `   Amount per order: $${(
            adjustedQuoteAmount / config.numberOfOrders
        ).toFixed(2)}`
    );

    // Debug: Show raw market precision data
    console.log(`\n🔍 Market Data Debug:`);
    console.log(`   Raw precision.amount: ${market?.precision?.amount}`);
    console.log(`   Raw precision.price: ${market?.precision?.price}`);
    console.log(`   Raw limits.price.min: ${market?.limits?.price?.min}`);
    console.log(`   Raw limits.amount.min: ${market?.limits?.amount?.min}`);

    // Get precision info from exchange
    // Note: precision can be either decimal places (e.g., 4) or tick size (e.g., 0.0001)
    const amountPrecision = market?.precision?.amount || 2;
    const pricePrecision = market?.precision?.price || 4;
    const minPrice = market?.limits?.price?.min || 0.0001;

    // Determine if precision is decimal places or tick size
    const amountDecimals =
        amountPrecision < 1 ? -Math.log10(amountPrecision) : amountPrecision;
    const priceDecimals =
        pricePrecision < 1 ? -Math.log10(pricePrecision) : pricePrecision;
    const amountTickSize =
        amountPrecision < 1 ? amountPrecision : Math.pow(10, -amountPrecision);
    const priceTickSize =
        pricePrecision < 1 ? pricePrecision : Math.pow(10, -pricePrecision);

    console.log(
        `\n📝 Placing ${config.numberOfOrders
        } ${config.side.toUpperCase()} orders:\n`
    );
    console.log(`   Amount decimals: ${amountDecimals}`);
    console.log(`   Amount tick size: ${amountTickSize}`);
    console.log(`   Price decimals: ${priceDecimals}`);
    console.log(`   Price tick size: ${priceTickSize}`);
    console.log(`   Min price: ${minPrice}\n`);

    // Prepare all orders first
    const orderPromises = orderDistribution.map((orderData, i) =>
        prepareAndPlaceOrder(
            exchangeInstance,
            config,
            orderData,
            i,
            currentPrice,
            market,
            amountDecimals,
            priceDecimals,
            amountTickSize,
            priceTickSize,
            minPrice,
            minCost,
            minAmount
        )
    );

    // Execute all orders in parallel
    console.log(
        color(
            `\n🚀 Placing ${orderPromises.filter((p) => p !== null).length} ${config.side
            } orders in parallel...\n`
        )
    );
    const results = await Promise.all(orderPromises);

    // Process results
    results.forEach((order) => {
        if (order) {
            placedOrders.push(order);
            totalBaseAmount += order.amount;
            totalQuoteAmount += order.quoteValue;
        }
    });

    // Log summary
    logOrderSummary(
        config.symbol,
        config.side,
        placedOrders,
        totalBaseAmount,
        totalQuoteAmount,
        currentPrice,
        config.spreadPercent
    );

    return {
        config,
        currentPrice,
        placedOrders,
        totalBaseAmount,
        totalQuoteAmount
    };
}

/**
 * Cancel all orders for a symbol
 */
export async function cancelMonoSideOrders(
    exchangeName: ExchangeName,
    symbol: string,
    orderIds?: string[],
    exchange?: ccxt.Exchange
): Promise<void> {
    const exchangeInstance = exchange || initExchange(exchangeName);

    console.log(`\n🗑️  Cancelling orders for ${symbol}...`);

    try {
        if (orderIds && orderIds.length > 0) {
            // Use native CCXT cancelAllOrders for batch cancellation
            try {
                await exchangeInstance.cancelAllOrders(symbol);
                console.log(`   ✅ Cancelled ${orderIds.length} order(s)`);
            } catch (error: any) {
                // If exchange doesn't support cancelOrders, fall back to individual cancellation
                if (
                    error.message?.includes("not supported") ||
                    error.message?.includes("NotSupported")
                ) {
                    console.log(
                        `   ℹ️  Batch cancel not supported, cancelling individually...`
                    );

                    const cancelPromises = orderIds.map((orderId) =>
                        trading
                            .cancelOrder(exchangeInstance, orderId, symbol)
                            .then(() => ({ orderId, status: "cancelled" as const }))
                            .catch((error: any) => {
                                if (
                                    error.message?.includes("ORDER_005") ||
                                    error.message?.includes("InvalidOrder")
                                ) {
                                    return { orderId, status: "already_gone" as const };
                                }
                                return {
                                    orderId,
                                    status: "failed" as const,
                                    error: error.message
                                };
                            })
                    );

                    const results = await Promise.all(cancelPromises);

                    let cancelledCount = 0;
                    let alreadyGoneCount = 0;
                    let failedCount = 0;

                    results.forEach((result) => {
                        if (result.status === "cancelled") {
                            cancelledCount++;
                        } else if (result.status === "already_gone") {
                            alreadyGoneCount++;
                        } else if (result.status === "failed") {
                            failedCount++;
                            console.error(
                                `   ❌ Failed ${result.orderId.substring(0, 12)}...: ${result.error
                                }`
                            );
                        }
                    });

                    console.log(
                        `   ℹ️  Summary: ${cancelledCount} cancelled, ${alreadyGoneCount} already filled/gone, ${failedCount} failed`
                    );
                } else {
                    throw error;
                }
            }
        }
    } catch (error) {
        console.error("   ❌ Error cancelling orders:", error);
        throw error;
    }
}

/**
 * Get current open orders for a symbol
 */
export async function getOpenOrders(
    exchangeName: ExchangeName,
    symbol: string
): Promise<any[]> {
    const exchange = initExchange(exchangeName);
    return await trading.fetchOpenOrders(exchange, symbol);
}

/**
 * Check and display account balance for the bot's side
 */
async function checkAccountBalance(
    exchange: ccxt.Exchange,
    config: MonoSideMMConfig
): Promise<void> {
    const [baseSymbol, quoteSymbol] = config.symbol.split("/");
    const color = getColor(config.side);

    console.log(color(`💰 Checking account balance [${config.side.toUpperCase()}]...\n`));

    try {
        if (config.side === "ask") {
            // For selling, check base currency
            const baseBalance = await account.getCurrencyBalance(
                exchange,
                baseSymbol
            );
            console.log(
                `   ${baseSymbol}: ${baseBalance.free.toFixed(
                    8
                )} (free) | ${baseBalance.total.toFixed(8)} (total)`
            );

            if (baseBalance.free === 0) {
                console.warn(
                    `⚠️  Warning: No ${baseSymbol} balance available to place ASK orders`
                );
            }
        } else {
            // For buying, check quote currency
            const quoteBalance = await account.getCurrencyBalance(
                exchange,
                quoteSymbol
            );
            console.log(
                `   ${quoteSymbol}: ${quoteBalance.free.toFixed(
                    2
                )} (free) | ${quoteBalance.total.toFixed(2)} (total)`
            );

            if (quoteBalance.free === 0) {
                console.warn(
                    `⚠️  Warning: No ${quoteSymbol} balance available to place BID orders`
                );
            }
        }
    } catch (error) {
        console.error("⚠️  Error checking balance:", error);
    }

    console.log("");
}

/**
 * Handle order fills - cancel remaining and check if we can place new orders
 */
async function handleOrderFills(
    config: MonoSideMMConfig,
    filled: string[],
    open: any[],
    activeOrderIds: string[],
    exchange: ccxt.Exchange
): Promise<boolean> {
    // Log the trade fill
    logTradeFill(config.side, filled);

    console.log(`📊 ${open.length} order(s) still open`);

    // Separate open orders by side to check if our side has any fills
    const ourSide = config.side === "bid" ? "buy" : "sell";
    const ourSideOpen = open.filter((o: any) => o.side === ourSide);

    console.log(
        `   ${config.side.toUpperCase()} side: ${ourSideOpen.length} open`
    );

    // If any of our orders filled (open count < initially placed), cancel all remaining
    if (ourSideOpen.length < activeOrderIds.length) {
        if (ourSideOpen.length > 0) {
            console.log(
                `\n⚠️  Some ${config.side.toUpperCase()} orders filled! Cancelling ${ourSideOpen.length
                } remaining order(s)...`
            );
            try {
                const ourSideIds = ourSideOpen.map((o: any) => o.id);
                await cancelMonoSideOrders(
                    config.exchange,
                    config.symbol,
                    ourSideIds,
                    exchange
                );
                console.log(
                    `✅ Cancelled all remaining ${config.side.toUpperCase()} orders\n`
                );
            } catch (error) {
                console.error("❌ Error cancelling orders:", error);
            }
        }

        // Re-fetch open orders to check if our side is clear after cancellation
        console.log(`🔍 Checking if ${config.side.toUpperCase()} side is clear...`);
        const allOpenOrders = await trading.fetchOpenOrders(
            exchange,
            config.symbol
        );
        const ourSideCount = allOpenOrders.filter(
            (o: any) => o.side === ourSide
        ).length;

        if (ourSideCount === 0) {
            console.log(
                `✅ ${config.side.toUpperCase()} side clear - placing new orders\n`
            );
            return true; // Can place new orders
        } else {
            console.log(
                `⏸  ${config.side.toUpperCase()} side still has ${ourSideCount} orders - will retry next cycle\n`
            );
            return false; // Wait for next cycle
        }
    }

    return false; // No action needed
}

/**
 * Monitor order fills and get filled orders
 * Returns info about our orders and side status
 */
export async function checkFilledOrders(
    exchangeName: ExchangeName,
    symbol: string,
    placedOrderIds: string[],
    ourSide: "buy" | "sell",
    exchange?: ccxt.Exchange
): Promise<{
    filled: string[];
    open: any[];
    ourSideTotalCount: number;
    ourSideOtherCount: number;
}> {
    const exchangeInstance = exchange || initExchange(exchangeName);

    // Fetch all open orders
    const openOrders = await trading.fetchOpenOrders(exchangeInstance, symbol);
    const openOrderIds = new Set(openOrders.map((o: any) => o.id));

    const filled: string[] = [];
    const open: any[] = [];

    // Compare placed orders with open orders
    for (const orderId of placedOrderIds) {
        if (openOrderIds.has(orderId)) {
            // Order is still open
            const order = openOrders.find((o: any) => o.id === orderId);
            if (order) open.push(order);
        } else {
            // Order not in open list = filled or cancelled
            filled.push(orderId);
        }
    }

    // Count all orders on our side
    const ourSideOrders = openOrders.filter((o: any) => o.side === ourSide);
    const ourSideTotalCount = ourSideOrders.length;

    // Count orders on our side that we didn't place (from other bot instances)
    const placedOrderIdsSet = new Set(placedOrderIds);
    const ourSideOtherCount = ourSideOrders.filter(
        (o: any) => !placedOrderIdsSet.has(o.id)
    ).length;

    // Log filled orders if any
    if (filled.length > 0) {
        console.log(
            `✅ ${filled.length} order(s) filled: ${filled
                .map((id) => id.substring(0, 12))
                .join(", ")}`
        );
    }

    return { filled, open, ourSideTotalCount, ourSideOtherCount };
}

/**
 * Start monitoring bot - checks orders every second
 */
export async function startMonitoring(
    config: MonoSideMMConfig = botConfig
): Promise<void> {
    const color = getColor(config.side);
    console.log(color(`🚀 Starting Mono-Side Market Maker Bot [${config.side.toUpperCase()}]...\n`));

    // Initialize exchange once and reuse
    const exchange = initExchange(config.exchange);

    // Load markets once and cache
    console.log(color(`📥 Loading market data [${config.side.toUpperCase()}]...`));
    const markets = await exchange.loadMarkets();
    const cachedMarket = markets[config.symbol];
    console.log(color(`✅ Market data cached [${config.side.toUpperCase()}]\n`));

    // Check account balance
    await checkAccountBalance(exchange, config);

    // Place initial orders immediately
    let activeOrderIds: string[] = [];

    console.log(color(`📤 Placing initial ${config.side.toUpperCase()} orders...\n`));
    try {
        const initialResult = await placeMonoSideOrders(
            config,
            exchange,
            cachedMarket
        );
        activeOrderIds = initialResult.placedOrders.map((o) => o.id);
        sendNotification(
            `Initial ${config.side.toUpperCase()} orders placed: ${activeOrderIds.length
            } orders`,
            "success"
        );
    } catch (error) {
        console.error("❌ Error placing initial orders:", error);
        sendNotification(
            `Failed to place initial ${config.side.toUpperCase()} orders: ${error}`,
            "error"
        );
        throw error;
    }

    const intervalSeconds = config.monitorIntervalSeconds || 1;
    console.log(
        color(`\n🔄 Monitoring started [${config.side.toUpperCase()}] - checking every ${intervalSeconds} second(s)...\n`)
    );

    let cycleCount = 0;
    const heartbeatInterval = Math.ceil(10 / intervalSeconds); // Show heartbeat every ~10 seconds

    // Monitor loop
    const monitorInterval = setInterval(async () => {
        cycleCount++;
        try {
            const ourSide = config.side === "bid" ? "buy" : "sell";

            // Fetch all open orders for the symbol
            const allOpenOrders = await trading.fetchOpenOrders(
                exchange,
                config.symbol
            );
            const ourSideOrders = allOpenOrders.filter(
                (o: any) => o.side === ourSide
            );

            // No orders on our side - place new orders immediately
            if (ourSideOrders.length === 0) {
                const color = getColor(config.side);
                console.log(
                    color(
                        `\n🔄 No ${config.side.toUpperCase()} orders detected. Placing new orders...\n`
                    )
                );

                try {
                    const result = await placeMonoSideOrders(
                        config,
                        exchange,
                        cachedMarket
                    );
                    activeOrderIds = result.placedOrders.map((o) => o.id);
                    sendNotification(
                        `Placed ${activeOrderIds.length
                        } ${config.side.toUpperCase()} orders after empty detection`,
                        "info"
                    );
                } catch (error) {
                    console.error(color(`❌ [${config.side.toUpperCase()}] Error placing new orders:`), error);
                    console.log("⏳ Will retry in next cycle...\n");
                    sendNotification(`Error placing orders: ${error}`, "error");
                }
                return;
            }

            // We have orders - first check for fills explicitly
            const { filled, open } = await checkFilledOrders(
                config.exchange,
                config.symbol,
                activeOrderIds,
                ourSide,
                exchange
            );

            // If any orders filled, handle fills and replace all orders
            if (filled.length > 0) {
                const canPlaceNew = await handleOrderFills(
                    config,
                    filled,
                    open,
                    activeOrderIds,
                    exchange
                );

                activeOrderIds = [];

                if (canPlaceNew) {
                    const color = getColor(config.side);
                    console.log(
                        color(`🔄 Placing fresh ${config.side.toUpperCase()} orders...\n`)
                    );
                    try {
                        const result = await placeMonoSideOrders(
                            config,
                            exchange,
                            cachedMarket
                        );
                        activeOrderIds = result.placedOrders.map((o) => o.id);
                        sendNotification(
                            `Refreshed ${config.side.toUpperCase()} orders after fill: ${activeOrderIds.length
                            } orders`,
                            "success"
                        );
                    } catch (error) {
                        console.error("❌ Error placing new orders:", error);
                        sendNotification(
                            `Error refreshing orders after fill: ${error}`,
                            "error"
                        );
                    }
                }
                return; // Done for this cycle
            }

            // No fills - check if orders need refreshing due to count or spread issues
            const activeOrderIdsSet = new Set(activeOrderIds);
            const ourOrders = ourSideOrders.filter((o: any) =>
                activeOrderIdsSet.has(o.id)
            );

            // Skip checks if we don't have all our orders tracked (shouldn't happen)
            if (ourOrders.length === 0 && activeOrderIds.length > 0) {
                const color = getColor(config.side);
                console.log(color(`⚠️  [${config.side.toUpperCase()}] Warning: Tracking mismatch, clearing state...\n`));
                activeOrderIds = [];
                return;
            }

            const driftThreshold =
                config.driftThresholdPercent || config.spreadPercent;

            // Get current reference price
            const referencePrice = await getReferencePrice(
                exchange,
                config.symbol,
                config.side,
                config.priceReference || "mid"
            );

            // Calculate closest order price and its distance
            let closestOrderPrice: number;
            if (config.side === "bid") {
                closestOrderPrice = Math.max(...ourOrders.map((o: any) => o.price));
            } else {
                closestOrderPrice = Math.min(...ourOrders.map((o: any) => o.price));
            }

            const distancePercent = Math.abs(
                ((closestOrderPrice - referencePrice) / referencePrice) * 100
            );

            // Check if refresh is needed
            const needsRefresh =
                ourOrders.length < config.numberOfOrders || // Missing orders (manual cancel, etc)
                distancePercent > driftThreshold; // Drifted beyond configured threshold

            if (needsRefresh) {
                const color = getColor(config.side);
                if (ourOrders.length < config.numberOfOrders) {
                    console.log(
                        color(
                            `\n⚠️  Order count mismatch: ${ourOrders.length}/${config.numberOfOrders} orders active`
                        )
                    );
                } else {
                    console.log(
                        color(
                            `\n📏 Drift threshold exceeded: ${distancePercent.toFixed(
                                3
                            )}% > ${driftThreshold.toFixed(3)}%`
                        )
                    );
                    console.log(
                        `   Closest order: ${closestOrderPrice.toFixed(
                            8
                        )} | Reference: ${referencePrice.toFixed(8)}`
                    );
                }

                console.log(
                    color(
                        `   Cancelling all ${config.side.toUpperCase()} orders and replacing...\n`
                    )
                );

                try {
                    // Cancel all our orders
                    const ourSideIds = ourOrders.map((o: any) => o.id);
                    await cancelMonoSideOrders(
                        config.exchange,
                        config.symbol,
                        ourSideIds,
                        exchange
                    );
                    console.log(`✅ Cancelled ${ourSideIds.length} order(s)\n`);

                    // Clear active order tracking
                    activeOrderIds = [];

                    // Re-verify side is clear before placing
                    const recheckOrders = await trading.fetchOpenOrders(
                        exchange,
                        config.symbol
                    );
                    const recheckOurSide = recheckOrders.filter(
                        (o: any) => o.side === ourSide
                    );

                    if (recheckOurSide.length === 0) {
                        console.log(
                            color(`🔄 Placing fresh ${config.side.toUpperCase()} orders...\n`)
                        );
                        const result = await placeMonoSideOrders(
                            config,
                            exchange,
                            cachedMarket
                        );
                        activeOrderIds = result.placedOrders.map((o) => o.id);
                        sendNotification(
                            `Refreshed ${config.side.toUpperCase()} orders (drift: ${distancePercent.toFixed(
                                2
                            )}%)`,
                            "info"
                        );
                    } else {
                        console.log(
                            color(
                                `⏸  ${config.side.toUpperCase()} side not clear (${recheckOurSide.length
                                } orders), will retry next cycle\n`
                            )
                        );
                    }
                } catch (error) {
                    console.error("❌ Error refreshing orders:", error);
                    sendNotification(`Error during order refresh: ${error}`, "error");
                    activeOrderIds = []; // Clear tracking on error
                }
            } else {
                // Everything stable - show heartbeat every ~10 seconds
                if (cycleCount % heartbeatInterval === 0) {
                    const color = getColor(config.side);
                    const now = new Date();
                    console.log(
                        color(
                            `💓 [${now.toLocaleTimeString()}] Monitoring... ${ourOrders.length
                            }/${config.numberOfOrders} ${config.side
                            } orders, drift: ${distancePercent.toFixed(3)}%`
                        )
                    );
                }
            }
        } catch (error) {
            const color = getColor(config.side);
            console.error(color(`❌ [${config.side.toUpperCase()}] Error during monitoring:`), error);
            console.log("⚠️  Continuing...\n");
        }
    }, intervalSeconds * 1000);

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
        console.log(color(`\n\n🛑 Shutting down [${config.side.toUpperCase()}]...`));
        clearInterval(monitorInterval);

        // Ask if user wants to cancel remaining orders
        console.log(color(`\n📊 Current open ${config.side.toUpperCase()} orders: ${activeOrderIds.length}`));

        // Cancel all remaining orders
        if (activeOrderIds.length > 0) {
            try {
                console.log(color(`\n🗑️  Cancelling all remaining ${config.side.toUpperCase()} orders...`));
                await exchange.cancelAllOrders();
            } catch (error) {
                console.error(color(`❌ [${config.side.toUpperCase()}] Error cancelling orders:`), error);
            }
        }

        console.log(color(`✅ ${config.side.toUpperCase()} bot stopped\n`));
        sendNotification("Bot stopped gracefully", "info");
        process.exit(0);
    });
}

/**
 * Run the bot
 */
export async function runBot() {
    try {
        const color = getColor(botConfig.side);
        console.log("\n" + "=".repeat(60));
        console.log(color("🤖 MONO-SIDE MARKET MAKER BOT"));
        console.log("=".repeat(60));
        console.log(`Exchange:       ${botConfig.exchange.toUpperCase()}`);
        console.log(`Symbol:         ${botConfig.symbol}`);
        console.log(color(`Side:           ${botConfig.side.toUpperCase()}`));
        console.log(`Total Amount:   ${botConfig.totalQuoteAmount}`);
        console.log(`Spread:         ${botConfig.spreadPercent}%`);
        console.log(`Orders:         ${botConfig.numberOfOrders}`);
        console.log(`Price Ref:      ${botConfig.priceReference || "mid"}`);
        console.log(
            `Drift Thresh:   ${botConfig.driftThresholdPercent || botConfig.spreadPercent
            }%`
        );
        console.log(`Monitor Int:    ${botConfig.monitorIntervalSeconds || 1}s`);
        console.log("=".repeat(60) + "\n");

        sendNotification(
            `Bot starting: ${botConfig.side.toUpperCase()} on ${botConfig.exchange.toUpperCase()} - ${botConfig.symbol
            }`,
            "info"
        );

        await startMonitoring(botConfig);
    } catch (error) {
        console.error("❌ Bot failed to start:", error);
        sendNotification(`Bot failed to start: ${error}`, "error");
        process.exit(1);
    }
}

// Auto-run when executed directly
if (require.main === module) {
    runBot().catch(console.error);
}
