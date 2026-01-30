/**
 * AI-Powered Auto Trading Bot
 * Fetches market data, calculates indicators, and uses OpenRouter AI to make trading decisions
 */

import * as ccxt from "ccxt";
import chalk from "chalk";
import { initExchange, type ExchangeName } from "../exchange";
import * as trading from "../trading";
import * as account from "../account";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface TradingConfig {
    exchange: ExchangeName;
    symbol: string;
    symbolToTrade: string;
    timeframe: string;
    candleCount: number;
    orderBookDepth: number;
    tradeAmount: number; // Amount to trade in quote currency
    checkIntervalSeconds: number;
    openRouterApiKey: string;
    aiModel: string;
    stopLossPercent: number; // Stop loss percentage (e.g., 0.25 for 0.25%)
    takeProfitPercent: number; // Take profit percentage (e.g., 1 for 1%)
    // Optional: Custom exchange API credentials
    exchangeApiKey?: string;
    exchangeSecret?: string;
    exchangePassword?: string;
}

interface CandleData {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

interface OrderBookData {
    bids: Array<[number, number]>; // [price, amount]
    asks: Array<[number, number]>;
    spread: number;
    spreadPercent: number;
}

interface TechnicalIndicators {
    sma20: number;
    sma50: number;
    ema12: number;
    ema26: number;
    rsi14: number;
    macd: {
        macd: number;
        signal: number;
        histogram: number;
    };
    bollinger: {
        upper: number;
        middle: number;
        lower: number;
    };
    atr14: number;
    momentum: number;
}

interface MarketData {
    candles: CandleData[];
    orderBook: OrderBookData;
    currentPrice: number;
    openTrades: any[];
    indicators: TechnicalIndicators;
    balance: {
        base: number;
        quote: number;
    };
}

interface AIResponse {
    action: "BUY" | "SELL" | "HOLD";
    confidence: number;
    reasoning: string;
    stopLoss?: number;
    takeProfit?: number;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const botConfig: TradingConfig = {
    exchange: (process.env.EXCHANGE as ExchangeName) || "binance",
    symbol: process.env.SYMBOL || "BTC/USDT",
    symbolToTrade: process.env.SYMBOL_TO_TRADE || "btc_usdt",
    timeframe: process.env.TIMEFRAME || "1m",
    candleCount: parseInt(process.env.CANDLE_COUNT || "100"),
    orderBookDepth: parseInt(process.env.ORDER_BOOK_DEPTH || "10"),
    tradeAmount: parseFloat(process.env.TRADE_AMOUNT || "20"),
    checkIntervalSeconds: parseFloat(
        process.env.CHECK_INTERVAL_SECONDS || "60"
    ),
    openRouterApiKey: process.env.OPENROUTER_API_KEY || "",
    aiModel:
        process.env.AI_MODEL || "qwen/qwen3-coder",
    stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT || "0.25"),
    takeProfitPercent: parseFloat(process.env.TAKE_PROFIT_PERCENT || "1"),
    // Custom exchange credentials (optional)
    exchangeApiKey: process.env.BINANCE_API_KEY || process.env.XT_API_KEY,
    exchangeSecret: process.env.BINANCE_SECRET || process.env.XT_SECRET_KEY,
    exchangePassword: process.env.EXCHANGE_PASSWORD,
};

// ============================================================================
// TECHNICAL INDICATORS
// ============================================================================

/**
 * Calculate Simple Moving Average
 */
function calculateSMA(data: number[], period: number): number {
    if (data.length < period) return 0;
    const slice = data.slice(-period);
    return slice.reduce((sum, val) => sum + val, 0) / period;
}

/**
 * Calculate Exponential Moving Average
 */
function calculateEMA(data: number[], period: number): number {
    if (data.length < period) return 0;

    const multiplier = 2 / (period + 1);
    let ema = calculateSMA(data.slice(0, period), period);

    for (let i = period; i < data.length; i++) {
        ema = (data[i] - ema) * multiplier + ema;
    }

    return ema;
}

/**
 * Calculate RSI (Relative Strength Index)
 */
function calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) return 50;

    const changes = [];
    for (let i = 1; i < prices.length; i++) {
        changes.push(prices[i] - prices[i - 1]);
    }

    let gains = 0;
    let losses = 0;

    for (let i = 0; i < period; i++) {
        if (changes[i] > 0) gains += changes[i];
        else losses -= changes[i];
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period; i < changes.length; i++) {
        if (changes[i] > 0) {
            avgGain = (avgGain * (period - 1) + changes[i]) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - changes[i]) / period;
        }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}

/**
 * Calculate MACD
 */
function calculateMACD(prices: number[]): {
    macd: number;
    signal: number;
    histogram: number;
} {
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    const macd = ema12 - ema26;

    // Calculate signal line (9-period EMA of MACD)
    const macdValues = [];
    for (let i = 26; i <= prices.length; i++) {
        const slice = prices.slice(0, i);
        const e12 = calculateEMA(slice, 12);
        const e26 = calculateEMA(slice, 26);
        macdValues.push(e12 - e26);
    }

    const signal = calculateEMA(macdValues, 9);
    const histogram = macd - signal;

    return { macd, signal, histogram };
}

/**
 * Calculate Bollinger Bands
 */
function calculateBollingerBands(
    prices: number[],
    period: number = 20,
    stdDev: number = 2
): { upper: number; middle: number; lower: number } {
    const sma = calculateSMA(prices, period);
    const slice = prices.slice(-period);

    const variance =
        slice.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
    const standardDeviation = Math.sqrt(variance);

    return {
        upper: sma + standardDeviation * stdDev,
        middle: sma,
        lower: sma - standardDeviation * stdDev,
    };
}

/**
 * Calculate ATR (Average True Range)
 */
function calculateATR(candles: CandleData[], period: number = 14): number {
    if (candles.length < period + 1) return 0;

    const trueRanges = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;

        const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        trueRanges.push(tr);
    }

    return calculateSMA(trueRanges, period);
}

/**
 * Calculate all technical indicators
 */
function calculateIndicators(candles: CandleData[]): TechnicalIndicators {
    const closes = candles.map((c) => c.close);

    return {
        sma20: calculateSMA(closes, 20),
        sma50: calculateSMA(closes, 50),
        ema12: calculateEMA(closes, 12),
        ema26: calculateEMA(closes, 26),
        rsi14: calculateRSI(closes, 14),
        macd: calculateMACD(closes),
        bollinger: calculateBollingerBands(closes, 20, 2),
        atr14: calculateATR(candles, 14),
        momentum: closes[closes.length - 1] - closes[closes.length - 10],
    };
}

// ============================================================================
// DATA FETCHING
// ============================================================================

/**
 * Fetch OHLCV candles
 */
async function fetchCandles(
    exchange: ccxt.Exchange,
    symbol: string,
    timeframe: string,
    count: number
): Promise<CandleData[]> {
    console.log(chalk.cyan(`📊 Fetching ${count} ${timeframe} candles...`));

    const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, count);

    const candles = ohlcv.map((candle) => ({
        timestamp: candle[0],
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5],
    }));

    console.log(
        chalk.green(`✅ Fetched ${candles.length} candles (Latest: $${candles[candles.length - 1].close.toFixed(8)})`)
    );

    return candles;
}

/**
 * Fetch order book
 */
async function fetchOrderBook(
    exchange: ccxt.Exchange,
    symbol: string,
    depth: number
): Promise<OrderBookData> {
    console.log(chalk.cyan(`📖 Fetching order book (depth: ${depth})...`));

    const orderBook = await exchange.fetchOrderBook(symbol, depth);

    const bids = orderBook.bids.slice(0, depth);
    const asks = orderBook.asks.slice(0, depth);

    const bestBid = bids[0]?.[0] || 0;
    const bestAsk = asks[0]?.[0] || 0;
    const spread = bestAsk - bestBid;
    const spreadPercent = (spread / bestBid) * 100;

    console.log(
        chalk.green(
            `✅ Order book: Best Bid: $${bestBid.toFixed(8)} | Best Ask: $${bestAsk.toFixed(8)} | Spread: ${spreadPercent.toFixed(3)}%`
        )
    );

    return {
        bids,
        asks,
        spread,
        spreadPercent,
    };
}

/**
 * Fetch open trades/positions
 */
async function fetchOpenTrades(
    exchange: ccxt.Exchange,
    symbol: string
): Promise<any[]> {
    console.log(chalk.cyan(`📋 Fetching open trades...`));

    try {
        const openOrders = await trading.fetchOpenOrders(exchange, symbol);
        console.log(chalk.green(`✅ Open trades: ${openOrders.length}`));
        return openOrders;
    } catch (error) {
        console.log(chalk.yellow(`⚠️  No open trades`));
        return [];
    }
}

/**
 * Fetch account balance
 */
async function fetchBalance(
    exchange: ccxt.Exchange,
    symbol: string
): Promise<{ base: number; quote: number }> {
    const [baseSymbol, quoteSymbol] = symbol.split("/");

    const baseBalance = await account.getCurrencyBalance(exchange, baseSymbol);
    const quoteBalance = await account.getCurrencyBalance(
        exchange,
        quoteSymbol
    );

    console.log(
        chalk.cyan(
            `💰 Balance: ${baseBalance.free.toFixed(8)} ${baseSymbol} | ${quoteBalance.free.toFixed(2)} ${quoteSymbol}`
        )
    );

    return {
        base: baseBalance.free,
        quote: quoteBalance.free,
    };
}

/**
 * Gather all market data
 */
async function gatherMarketData(
    exchange: ccxt.Exchange,
    config: TradingConfig
): Promise<MarketData> {
    console.log(chalk.cyan(`\n${"=".repeat(60)}`));
    console.log(chalk.cyan.bold(`📈 GATHERING MARKET DATA`));
    console.log(chalk.cyan(`${"=".repeat(60)}\n`));

    const [candles, orderBook, openTrades, balance] = await Promise.all([
        fetchCandles(
            exchange,
            config.symbol,
            config.timeframe,
            config.candleCount
        ),
        fetchOrderBook(exchange, config.symbol, config.orderBookDepth),
        fetchOpenTrades(exchange, config.symbol),
        fetchBalance(exchange, config.symbol),
    ]);

    console.log(chalk.cyan(`\n🔬 Calculating technical indicators...`));
    const indicators = calculateIndicators(candles);

    console.log(chalk.green(`✅ RSI: ${indicators.rsi14.toFixed(2)}`));
    console.log(
        chalk.green(
            `✅ MACD: ${indicators.macd.macd.toFixed(8)} | Signal: ${indicators.macd.signal.toFixed(8)}`
        )
    );
    console.log(
        chalk.green(
            `✅ Bollinger: Upper ${indicators.bollinger.upper.toFixed(8)} | Lower ${indicators.bollinger.lower.toFixed(8)}`
        )
    );

    const currentPrice = candles[candles.length - 1].close;

    console.log(chalk.cyan(`${"=".repeat(60)}\n`));

    return {
        candles,
        orderBook,
        currentPrice,
        openTrades,
        indicators,
        balance,
    };
}

// ============================================================================
// AI INTEGRATION (OpenRouter)
// ============================================================================

/**
 * Send data to AI and get trading decision
 */
async function getAIDecision(
    marketData: MarketData,
    config: TradingConfig
): Promise<AIResponse> {
    console.log(chalk.cyan(`🤖 Consulting AI for trading decision...`));

    // Calculate position info
    const hasPosition = marketData.balance.base > 0;
    const positionValue = hasPosition ? marketData.balance.base * marketData.currentPrice : 0;

    // Prepare data for AI
    const aiData = {
        symbol: config.symbol,
        currentPrice: marketData.currentPrice,
        balance: marketData.balance,
        position: {
            hasOpenPosition: hasPosition,
            baseAmount: marketData.balance.base,
            currentValue: positionValue,
            // AI should consider selling if we have a position
        },
        recentCandles: marketData.candles.slice(-20), // Last 20 candles
        orderBook: {
            topBids: marketData.orderBook.bids.slice(0, 5),
            topAsks: marketData.orderBook.asks.slice(0, 5),
            spread: marketData.orderBook.spread,
            spreadPercent: marketData.orderBook.spreadPercent,
        },
        openOrders: marketData.openTrades.length,
        indicators: marketData.indicators,
        riskLimits: {
            stopLossPercent: config.stopLossPercent,
            takeProfitPercent: config.takeProfitPercent,
        },
    };

    const prompt = `You are a professional cryptocurrency trading bot. Analyze the following market data and provide a trading decision.

Market Data (JSON):
${JSON.stringify(aiData, null, 2)}

IMPORTANT TRADING RULES:
1. If position.hasOpenPosition is TRUE and you have base currency, consider SELLING to take profit or cut losses
2. If position.hasOpenPosition is FALSE, you can only BUY (or HOLD)
3. Use stopLossPercent (${config.stopLossPercent}%) and takeProfitPercent (${config.takeProfitPercent}%) as risk guidelines
4. SELL when:
   - Indicators suggest downtrend and you're in profit
   - Price has moved against you significantly
   - Technical signals show reversal
5. BUY when:
   - No open position AND indicators show strong uptrend
   - Risk/reward is favorable
6. HOLD when:
   - Uncertain market conditions
   - Already in position but indicators still bullish
   - No clear signal

Based on this data, provide your analysis in the following JSON format ONLY (no other text):
{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": 0-100,
  "reasoning": "Brief explanation of your decision"
}

Consider:
- Current position status (are we holding any coins?)
- Technical indicators (RSI, MACD, Bollinger Bands)
- Order book depth and spread
- Recent price action and momentum
- Risk management and exit strategy
- Profit taking opportunities

Respond with ONLY the JSON object, nothing else.`;

    try {
        const response = await fetch(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${config.openRouterApiKey}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://github.com/your-repo",
                    "X-Title": "AI Trading Bot",
                },
                body: JSON.stringify({
                    model: config.aiModel,
                    messages: [
                        {
                            role: "user",
                            content: prompt,
                        },
                    ],
                }),
            }
        );

        if (!response.ok) {
            throw new Error(`OpenRouter API error: ${response.statusText}`);
        }

        const data = await response.json();
        const aiResponseText = data.choices[0].message.content;

        // Parse JSON response
        const jsonMatch = aiResponseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("AI did not return valid JSON");
        }

        const aiDecision: AIResponse = JSON.parse(jsonMatch[0]);

        console.log(chalk.green(`✅ AI Decision: ${aiDecision.action}`));
        console.log(
            chalk.white(`   Confidence: ${aiDecision.confidence}%`)
        );
        console.log(chalk.white(`   Reasoning: ${aiDecision.reasoning}`));

        return aiDecision;
    } catch (error: any) {
        console.error(chalk.red(`❌ AI Error: ${error.message}`));
        // Default to HOLD on error
        return {
            action: "HOLD",
            confidence: 0,
            reasoning: "AI service unavailable - defaulting to HOLD",
        };
    }
}

// ============================================================================
// TRADING EXECUTION
// ============================================================================

/**
 * Execute AI trading decision
 */
async function executeDecision(
    exchange: ccxt.Exchange,
    config: TradingConfig,
    marketData: MarketData,
    decision: AIResponse
): Promise<void> {
    if (decision.action === "HOLD") {
        console.log(chalk.yellow(`⏸  AI recommends HOLD - no action taken`));
        return;
    }

    // Check confidence threshold
    if (decision.confidence < 75) {
        console.log(
            chalk.yellow(
                `⚠️  AI confidence (${decision.confidence}%) below threshold (75%) - skipping trade`
            )
        );
        console.log(chalk.white(`   Reasoning: ${decision.reasoning}\n`));
        return;
    }

    const [baseSymbol, quoteSymbol] = config.symbol.split("/");

    console.log(chalk.cyan(`\n💱 Symbol parsing: "${config.symbol}" -> Base: "${baseSymbol}", Quote: "${quoteSymbol}"`));

    if (decision.action === "BUY") {
        // Check if we have enough quote currency
        console.log(chalk.cyan(`💰 Balance check: ${marketData.balance.quote} ${quoteSymbol} >= ${config.tradeAmount} required`));

        if (marketData.balance.quote < config.tradeAmount) {
            console.log(
                chalk.red(
                    `❌ Insufficient ${quoteSymbol} balance for BUY order`
                )
            );
            return;
        }

        console.log(
            chalk.green(
                `\n🛒 EXECUTING BUY ORDER (AI Confidence: ${decision.confidence}%)`
            )
        );

        // Fetch market info for constraints using the actual trading symbol
        const markets = await exchange.loadMarkets();
        console.log(chalk.yellow(`\n   🔍 Looking for market: ${config.symbol}`));
        const market = markets[config.symbol];

        if (!market) {
            console.log(chalk.red(`❌ Market not found for ${config.symbol}`));
            console.log(chalk.yellow(`\n   📋 Searching for BTC/USDT alternatives...`));
            const btcMarkets = Object.keys(markets).filter(m =>
                m.toUpperCase().includes('BTC') && m.toUpperCase().includes('USDT')
            );
            console.log(chalk.white(`   Found ${btcMarkets.length} BTC/USDT markets:`));
            btcMarkets.slice(0, 10).forEach(m => {
                console.log(chalk.white(`   - ${m} (ID: ${markets[m].id})`));
            });
            return;
        }

        const minCost = market?.limits?.cost?.min || 1;
        const minAmount = market?.limits?.amount?.min || 0;
        const amountPrecision = market?.precision?.amount || 8;
        const pricePrecision = market?.precision?.price || 8;

        console.log(chalk.yellow(`\n   📋 Market Constraints:`));
        console.log(chalk.white(`   Found Market: ${market.symbol} (ID: ${market.id})`));
        console.log(chalk.white(`   Min Cost: $${minCost}`));
        console.log(chalk.white(`   Min Amount: ${minAmount} ${baseSymbol}`));
        console.log(chalk.white(`   Amount Precision: ${amountPrecision}`));
        console.log(chalk.white(`   Price Precision: ${pricePrecision}`));

        // Log full market info
        console.log(chalk.yellow(`\n   🔍 Full Market Info:`));
        console.log(chalk.white(`   Limits: ${JSON.stringify(market?.limits)}`));
        console.log(chalk.white(`   Precision: ${JSON.stringify(market?.precision)}`));
        console.log(chalk.white(`   Active: ${market?.active}`));
        console.log(chalk.white(`   Spot: ${market?.spot}`));

        // Use best ask price for limit order (will execute immediately)
        let buyPrice = marketData.orderBook.asks[0]?.[0] || marketData.currentPrice;
        let amount = config.tradeAmount / buyPrice;

        // Apply precision using the EXACT same logic as mm-both-side.ts
        const amountDecimals = amountPrecision < 1 ? -Math.log10(amountPrecision) : amountPrecision;
        const priceDecimals = pricePrecision < 1 ? -Math.log10(pricePrecision) : pricePrecision;
        const amountTickSize = amountPrecision < 1 ? amountPrecision : Math.pow(10, -amountPrecision);
        const priceTickSize = pricePrecision < 1 ? pricePrecision : Math.pow(10, -pricePrecision);

        // Round to exchange precision using tick size
        buyPrice = Math.round(buyPrice / priceTickSize) * priceTickSize;
        buyPrice = parseFloat(buyPrice.toFixed(priceDecimals));

        amount = Math.round(amount / amountTickSize) * amountTickSize;
        amount = parseFloat(amount.toFixed(amountDecimals));

        console.log(chalk.cyan(`\n   🔢 Precision Calculation:`));
        console.log(chalk.white(`   Amount Decimals: ${amountDecimals}, Tick Size: ${amountTickSize}`));
        console.log(chalk.white(`   Price Decimals: ${priceDecimals}, Tick Size: ${priceTickSize}`));
        console.log(chalk.white(`   Final Amount: ${amount}`));
        console.log(chalk.white(`   Final Price: ${buyPrice}`));

        // Check minimum constraints
        const cost = amount * buyPrice;
        if (cost < minCost) {
            console.log(chalk.red(`❌ Order cost $${cost.toFixed(2)} below minimum $${minCost}`));
            return;
        }
        if (amount < minAmount) {
            console.log(chalk.red(`❌ Order amount ${amount} ${baseSymbol} below minimum ${minAmount}`));
            return;
        }

        console.log(
            chalk.cyan(
                `   Limit Order: ${amount} ${baseSymbol} @ $${buyPrice} (Best Ask)`
            )
        );
        console.log(chalk.cyan(`   Cost: $${cost.toFixed(2)} ${quoteSymbol} (Min: $${minCost})`));
        console.log(chalk.cyan(`   Amount: ${amount} ${baseSymbol} (Min: ${minAmount})\n`));

        try {
            // Log the exact parameters being sent
            console.log(chalk.yellow(`\n   📤 Sending order to exchange:`));
            console.log(chalk.white(`   Symbol: ${config.symbol}`));

            // Get XT's internal symbol format
            const marketInfo = await exchange.loadMarkets();
            const xtSymbol = marketInfo[config.symbol]?.id || config.symbol;
            console.log(chalk.white(`   XT Symbol ID: ${xtSymbol}`));

            console.log(chalk.white(`   Type: limit`));
            console.log(chalk.white(`   Side: buy`));
            console.log(chalk.white(`   Amount: ${amount} (type: ${typeof amount})`));
            console.log(chalk.white(`   Price: ${buyPrice} (type: ${typeof buyPrice})\n`));

            // Place limit order at best ask price (no params, like mm-both-side.ts)
            console.log(chalk.yellow(`   📦 Order: ${amount} ${baseSymbol} @ $${buyPrice}\n`));

            const order = await trading.createLimitOrder(
                exchange,
                config.symbol,
                "buy",
                amount,
                buyPrice
            );

            console.log(chalk.green(`✅ BUY Order executed!`));
            console.log(chalk.white(`   Order ID: ${order.id}`));
            console.log(
                chalk.white(
                    `   Amount: ${(order.filled || 0).toFixed(8)} ${baseSymbol}`
                )
            );
            console.log(
                chalk.white(
                    `   Avg Price: $${(order.average || marketData.currentPrice).toFixed(8)}`
                )
            );
            console.log(chalk.white(`   Reasoning: ${decision.reasoning}\n`));
        } catch (error: any) {
            console.error(chalk.red(`❌ BUY order failed: ${error.message}`));
            console.error(chalk.yellow(`\n   Debug Info:`));
            console.error(chalk.white(`   Symbol: ${config.symbol}`));
            console.error(chalk.white(`   Side: buy`));
            console.error(chalk.white(`   Amount: ${amount}`));
            console.error(chalk.white(`   Price: ${buyPrice}`));
            console.error(chalk.white(`   Cost: $${(amount * buyPrice).toFixed(2)}`));
        }
    } else if (decision.action === "SELL") {
        // Fetch fresh balance to ensure we have the latest data
        console.log(chalk.cyan(`\n💰 Fetching current ${baseSymbol} balance...`));
        const currentBalance = await account.getCurrencyBalance(exchange, baseSymbol);
        const currentBaseAmount = currentBalance.free;

        console.log(chalk.white(`   Available: ${currentBaseAmount.toFixed(8)} ${baseSymbol}`));

        // Check if we have base currency to sell
        if (currentBaseAmount === 0) {
            console.log(
                chalk.red(`❌ No ${baseSymbol} balance to SELL`)
            );
            return;
        }

        console.log(
            chalk.red(
                `\n💸 EXECUTING SELL ORDER (AI Confidence: ${decision.confidence}%)`
            )
        );

        // Fetch market info for constraints
        const markets = await exchange.loadMarkets();
        const market = markets[config.symbol];

        if (!market) {
            console.log(chalk.red(`❌ Market not found for ${config.symbol}`));
            return;
        }

        const amountPrecision = market?.precision?.amount || 8;
        const pricePrecision = market?.precision?.price || 8;

        // Use best bid price for limit order (will execute immediately)
        let sellPrice = marketData.orderBook.bids[0]?.[0] || marketData.currentPrice;

        // Use current balance instead of old balance
        let amount = currentBaseAmount;

        // Apply precision using the EXACT same logic as mm-both-side.ts
        const amountDecimals = amountPrecision < 1 ? -Math.log10(amountPrecision) : amountPrecision;
        const priceDecimals = pricePrecision < 1 ? -Math.log10(pricePrecision) : pricePrecision;
        const amountTickSize = amountPrecision < 1 ? amountPrecision : Math.pow(10, -amountPrecision);
        const priceTickSize = pricePrecision < 1 ? pricePrecision : Math.pow(10, -pricePrecision);

        // Round to exchange precision using tick size
        sellPrice = Math.round(sellPrice / priceTickSize) * priceTickSize;
        sellPrice = parseFloat(sellPrice.toFixed(priceDecimals));

        amount = Math.round(amount / amountTickSize) * amountTickSize;
        amount = parseFloat(amount.toFixed(amountDecimals));

        console.log(chalk.cyan(`\n   🔢 Precision Calculation:`));
        console.log(chalk.white(`   Amount Decimals: ${amountDecimals}, Tick Size: ${amountTickSize}`));
        console.log(chalk.white(`   Price Decimals: ${priceDecimals}, Tick Size: ${priceTickSize}`));
        console.log(chalk.white(`   Final Amount: ${amount}`));
        console.log(chalk.white(`   Final Price: ${sellPrice}`));

        console.log(
            chalk.cyan(
                `   Limit Order: ${amount.toFixed(8)} ${baseSymbol} @ $${sellPrice.toFixed(8)} (Best Bid)`
            )
        );
        console.log(chalk.cyan(`   Value: ~${(amount * sellPrice).toFixed(2)} ${quoteSymbol}`));

        try {
            // Place limit order at best bid price
            const order = await trading.createLimitOrder(
                exchange,
                config.symbol,
                "sell",
                amount,
                sellPrice
            );

            console.log(chalk.green(`✅ SELL Order executed!`));
            console.log(chalk.white(`   Order ID: ${order.id}`));
            console.log(
                chalk.white(
                    `   Amount: ${amount.toFixed(8)} ${baseSymbol}`
                )
            );
            console.log(
                chalk.white(
                    `   Value: ~${(amount * marketData.currentPrice).toFixed(2)} ${quoteSymbol}`
                )
            );
            console.log(chalk.white(`   Reasoning: ${decision.reasoning}\n`));
        } catch (error: any) {
            console.error(chalk.red(`❌ SELL order failed: ${error.message}`));
        }
    }
}

// ============================================================================
// MAIN BOT
// ============================================================================

/**
 * Start the AI trading bot
 */
export async function startBot(
    config: TradingConfig = botConfig
): Promise<void> {
    console.log(chalk.cyan.bold(`\n🤖 Starting AI-Powered Trading Bot...\n`));

    // Validate API key
    if (!config.openRouterApiKey) {
        console.error(
            chalk.red(
                `❌ OPENROUTER_API_KEY environment variable is required!`
            )
        );
        process.exit(1);
    }

    // Initialize exchange - use proper defaults with custom credentials
    let exchange: ccxt.Exchange;

    if (config.exchangeApiKey) {
        // Custom credentials: create exchange with defaultConfig settings
        const ExchangeClass = (ccxt as any)[config.exchange] as typeof ccxt.Exchange;
        exchange = new ExchangeClass({
            apiKey: config.exchangeApiKey,
            secret: config.exchangeSecret,
            password: config.exchangePassword,
            enableRateLimit: true,
            timeout: 30000,
            recvWindow: 10000,
        });
        console.log(chalk.yellow(`🔑 Using custom API credentials (XT_API_KEY_2)\n`));
    } else {
        // Use standard initExchange for default credentials
        exchange = initExchange(config.exchange);
    }

    // Load markets immediately after initialization
    console.log(chalk.cyan(`🔄 Loading exchange markets...`));
    await exchange.loadMarkets();
    console.log(chalk.green(`✅ Markets loaded: ${Object.keys(exchange.markets).length} markets\n`));

    // Set option for XT exchange market buy orders - must pass cost as amount
    // if (!exchange.options) {
    //     exchange.options = {};
    // }
    // exchange.options['createMarketBuyOrderRequiresPrice'] = false;

    console.log(chalk.cyan(`${"=".repeat(60)}`));
    console.log(chalk.cyan.bold(`⚙️  BOT CONFIGURATION`));
    console.log(chalk.cyan(`${"=".repeat(60)}`));
    console.log(`Exchange:       ${config.exchange.toUpperCase()}`);
    console.log(`Symbol:         ${config.symbol}`);
    console.log(`Timeframe:      ${config.timeframe}`);
    console.log(`Trade Amount:   $${config.tradeAmount}`);
    console.log(`Check Interval: ${config.checkIntervalSeconds}s`);
    console.log(`AI Model:       ${config.aiModel}`);
    console.log(chalk.cyan(`${"=".repeat(60)}\n`));

    // Check initial balances
    console.log(chalk.cyan(`💰 Checking initial balances...`));
    try {
        const [baseSymbol, quoteSymbol] = config.symbol.split("/");
        const baseBalance = await account.getCurrencyBalance(exchange, baseSymbol);
        const quoteBalance = await account.getCurrencyBalance(exchange, quoteSymbol);

        console.log(chalk.green(`✅ ${baseSymbol} Balance:`));
        console.log(chalk.white(`   Free: ${baseBalance.free.toFixed(8)} ${baseSymbol}`));
        console.log(chalk.white(`   Used: ${baseBalance.used.toFixed(8)} ${baseSymbol}`));
        console.log(chalk.white(`   Total: ${baseBalance.total.toFixed(8)} ${baseSymbol}`));

        console.log(chalk.green(`✅ ${quoteSymbol} Balance:`));
        console.log(chalk.white(`   Free: ${quoteBalance.free.toFixed(2)} ${quoteSymbol}`));
        console.log(chalk.white(`   Used: ${quoteBalance.used.toFixed(2)} ${quoteSymbol}`));
        console.log(chalk.white(`   Total: ${quoteBalance.total.toFixed(2)} ${quoteSymbol}\n`));
    } catch (error: any) {
        console.error(chalk.red(`❌ Failed to fetch balances: ${error.message}\n`));
    }

    // Main loop
    let cycleCount = 0;

    const mainLoop = async () => {
        cycleCount++;
        console.log(
            chalk.cyan(
                `\n${"=".repeat(60)}\n🔄 CYCLE ${cycleCount} - ${new Date().toLocaleString()}\n${"=".repeat(60)}`
            )
        );

        try {
            // 1. Gather market data
            const marketData = await gatherMarketData(exchange, config);

            // 2. Get AI decision
            const decision = await getAIDecision(marketData, config);

            console.log("AI decision received:", decision);

            // 3. Execute decision
            await executeDecision(exchange, config, marketData, decision);

            console.log(
                chalk.cyan(
                    `\n⏳ Next check in ${config.checkIntervalSeconds} seconds...\n`
                )
            );
        } catch (error: any) {
            console.error(chalk.red(`❌ Error in cycle ${cycleCount}:`), error);
            console.log(chalk.yellow(`⚠️  Continuing to next cycle...\n`));
        }
    };

    // Run immediately
    await mainLoop();

    // Then run on interval
    const interval = setInterval(mainLoop, config.checkIntervalSeconds * 1000);

    // Graceful shutdown
    process.on("SIGINT", async () => {
        console.log(chalk.yellow(`\n\n🛑 Shutting down AI Trading Bot...`));
        clearInterval(interval);
        console.log(chalk.green(`✅ Bot stopped\n`));
        process.exit(0);
    });
}

/**
 * Run the bot
 */
export async function runBot() {
    try {
        await startBot(botConfig);
    } catch (error) {
        console.error(chalk.red("❌ Bot failed to start:"), error);
        process.exit(1);
    }
}

// Auto-run when executed directly
if (require.main === module) {
    runBot().catch(console.error);
}
