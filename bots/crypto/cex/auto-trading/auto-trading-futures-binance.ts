/**
 * AI-Powered Futures Auto Trading Bot - Binance
 * Fetches market data, calculates indicators, and uses OpenRouter AI for futures trading decisions
 */

import * as ccxt from "ccxt";
import chalk from "chalk";
import dotenv from "dotenv";
import path from "path";

// Load environment variables - try multiple paths
const envPaths = [
    path.resolve(__dirname, '../../.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
];

for (const envPath of envPaths) {
    const result = dotenv.config({ path: envPath });
    if (!result.error) {
        console.log(chalk.gray(`Loaded .env from: ${envPath}\n`));
        break;
    }
}

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface TradingConfig {
    exchange: "binance";
    symbol: string;
    timeframe: string;
    candleCount: number;
    orderBookDepth: number;
    positionSize: number; // Position size in USDT
    leverage: number;
    checkIntervalSeconds: number;
    openRouterApiKey: string;
    aiModel: string;
    stopLossPercent: number;
    takeProfitPercent: number;
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
    bids: Array<[number, number]>;
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
    macd: { macd: number; signal: number; histogram: number };
    bollinger: { upper: number; middle: number; lower: number };
    atr14: number;
    momentum: number;
}

interface Position {
    symbol: string;
    side: "long" | "short" | "none";
    contracts: number;
    entryPrice: number;
    leverage: number;
    unrealizedPnl: number;
    percentage: number;
}

interface MarketData {
    candles: CandleData[];
    candles15m: CandleData[];
    orderBook: OrderBookData;
    currentPrice: number;
    position: Position;
    indicators: TechnicalIndicators;
    balance: number;
}

interface AIResponse {
    action: "LONG" | "SHORT" | "CLOSE" | "HOLD";
    confidence: number;
    reasoning: string;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const botConfig: TradingConfig = {
    exchange: "binance",
    symbol: process.env.SYMBOL || "BNB/USDT:USDT",
    timeframe: process.env.TIMEFRAME || "1m",
    candleCount: parseInt(process.env.CANDLE_COUNT || "100"),
    orderBookDepth: parseInt(process.env.ORDER_BOOK_DEPTH || "10"),
    positionSize: parseFloat(process.env.POSITION_SIZE || "10"),
    leverage: parseInt(process.env.LEVERAGE || "10"),
    checkIntervalSeconds: parseFloat(process.env.CHECK_INTERVAL_SECONDS || "60"),
    openRouterApiKey: process.env.OPENROUTER_API_KEY || "",
    aiModel: process.env.AI_MODEL || "qwen/qwen3-coder",
    stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT || "3"),
    takeProfitPercent: parseFloat(process.env.TAKE_PROFIT_PERCENT || "9"),
};

// ============================================================================
// TECHNICAL INDICATORS (Same as spot bot)
// ============================================================================

function calculateSMA(data: number[], period: number): number {
    if (data.length < period) return 0;
    const slice = data.slice(-period);
    return slice.reduce((sum, val) => sum + val, 0) / period;
}

function calculateEMA(data: number[], period: number): number {
    if (data.length < period) return 0;
    const multiplier = 2 / (period + 1);
    let ema = calculateSMA(data.slice(0, period), period);
    for (let i = period; i < data.length; i++) {
        ema = (data[i] - ema) * multiplier + ema;
    }
    return ema;
}

function calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) return 50;
    const changes = [];
    for (let i = 1; i < prices.length; i++) {
        changes.push(prices[i] - prices[i - 1]);
    }
    let gains = 0, losses = 0;
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

function calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    const macd = ema12 - ema26;
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

function calculateBollingerBands(prices: number[], period: number = 20, stdDev: number = 2): { upper: number; middle: number; lower: number } {
    const sma = calculateSMA(prices, period);
    const slice = prices.slice(-period);
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
    const standardDeviation = Math.sqrt(variance);
    return {
        upper: sma + standardDeviation * stdDev,
        middle: sma,
        lower: sma - standardDeviation * stdDev,
    };
}

function calculateATR(candles: CandleData[], period: number = 14): number {
    if (candles.length < period + 1) return 0;
    const trueRanges = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trueRanges.push(tr);
    }
    return calculateSMA(trueRanges, period);
}

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

async function fetchCandles(exchange: ccxt.Exchange, symbol: string, timeframe: string, count: number): Promise<CandleData[]> {
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
    console.log(chalk.green(`✅ Fetched ${candles.length} candles (Latest: $${candles[candles.length - 1].close.toFixed(2)})`));
    return candles;
}

async function fetchOrderBook(exchange: ccxt.Exchange, symbol: string, depth: number): Promise<OrderBookData> {
    console.log(chalk.cyan(`📖 Fetching order book...`));
    const orderBook = await exchange.fetchOrderBook(symbol, depth);
    const bids = orderBook.bids.slice(0, depth);
    const asks = orderBook.asks.slice(0, depth);
    const bestBid = bids[0]?.[0] || 0;
    const bestAsk = asks[0]?.[0] || 0;
    const spread = bestAsk - bestBid;
    const spreadPercent = (spread / bestBid) * 100;
    console.log(chalk.green(`✅ Order book: Spread: ${spreadPercent.toFixed(3)}%`));
    return { bids, asks, spread, spreadPercent };
}

async function fetchPosition(exchange: ccxt.Exchange, symbol: string): Promise<Position> {
    console.log(chalk.cyan(`📋 Fetching position...`));
    try {
        const positions = await exchange.fetchPositions([symbol]);
        const pos = positions.find((p: any) => p.symbol === symbol);

        if (!pos || parseFloat(pos.contracts || "0") === 0) {
            console.log(chalk.yellow(`⚠️  No open position`));
            return {
                symbol,
                side: "none",
                contracts: 0,
                entryPrice: 0,
                leverage: 0,
                unrealizedPnl: 0,
                percentage: 0,
            };
        }

        const pnlPercent = pos.percentage || 0;
        console.log(chalk.green(`✅ Position: ${pos.side?.toUpperCase()} ${pos.contracts} contracts @ $${pos.entryPrice} | PnL: ${pnlPercent > 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`));

        return {
            symbol: pos.symbol,
            side: pos.side as "long" | "short",
            contracts: parseFloat(pos.contracts || "0"),
            entryPrice: parseFloat(pos.entryPrice || "0"),
            leverage: parseFloat(pos.leverage || "0"),
            unrealizedPnl: parseFloat(pos.unrealizedPnl || "0"),
            percentage: pnlPercent,
        };
    } catch (error) {
        console.log(chalk.yellow(`⚠️  No open position`));
        return {
            symbol,
            side: "none",
            contracts: 0,
            entryPrice: 0,
            leverage: 0,
            unrealizedPnl: 0,
            percentage: 0,
        };
    }
}

async function fetchBalance(exchange: ccxt.Exchange): Promise<number> {
    const balance = await exchange.fetchBalance();
    const usdtBalance = balance.USDT?.free || 0;
    console.log(chalk.cyan(`💰 Balance: ${usdtBalance.toFixed(2)} USDT`));
    return usdtBalance;
}

async function gatherMarketData(exchange: ccxt.Exchange, config: TradingConfig): Promise<MarketData> {
    console.log(chalk.cyan(`\n${"=".repeat(60)}`));
    console.log(chalk.cyan.bold(`📈 GATHERING MARKET DATA`));
    console.log(chalk.cyan(`${"=".repeat(60)}\n`));

    const [candles, candles15m, orderBook, position, balance] = await Promise.all([
        fetchCandles(exchange, config.symbol, config.timeframe, config.candleCount),
        fetchCandles(exchange, config.symbol, "15m", 100),
        fetchOrderBook(exchange, config.symbol, config.orderBookDepth),
        fetchPosition(exchange, config.symbol),
        fetchBalance(exchange),
    ]);

    console.log(chalk.cyan(`\n🔬 Calculating technical indicators...`));
    const indicators = calculateIndicators(candles);
    console.log(chalk.green(`✅ RSI: ${indicators.rsi14.toFixed(2)}`));
    console.log(chalk.green(`✅ MACD: ${indicators.macd.macd.toFixed(2)} | Signal: ${indicators.macd.signal.toFixed(2)}`));

    const currentPrice = candles[candles.length - 1].close;
    console.log(chalk.cyan(`${"=".repeat(60)}\n`));

    return { candles, candles15m, orderBook, currentPrice, position, indicators, balance };
}

// ============================================================================
// AI INTEGRATION
// ============================================================================

async function getAIDecision(marketData: MarketData, config: TradingConfig): Promise<AIResponse> {
    console.log(chalk.cyan(`🤖 Consulting AI for trading decision...`));

    const aiData = {
        symbol: config.symbol,
        currentPrice: marketData.currentPrice,
        balance: marketData.balance,
        position: {
            hasOpenPosition: marketData.position.side !== "none",
            side: marketData.position.side,
            contracts: marketData.position.contracts,
            entryPrice: marketData.position.entryPrice,
            unrealizedPnl: marketData.position.unrealizedPnl,
            pnlPercentage: marketData.position.percentage,
        },
        recentCandles1m: marketData.candles,
        candles15m: marketData.candles15m,
        orderBook: {
            topBids: marketData.orderBook.bids.slice(0, 5),
            topAsks: marketData.orderBook.asks.slice(0, 5),
            spread: marketData.orderBook.spread,
            spreadPercent: marketData.orderBook.spreadPercent,
        },
        indicators: marketData.indicators,
        riskLimits: {
            stopLossPercent: config.stopLossPercent,
            takeProfitPercent: config.takeProfitPercent,
            leverage: config.leverage,
        },
    };

    const prompt = `You are a professional cryptocurrency futures swing trader with expertise in technical analysis and risk management, and vast experience in profitable trades. Your trading stragtegy is 97% accurate. Do the trading, you trade on ${config.timeframe} timeframe. If you think potential downtrend is strong, you can do SHORT position even if current trend is uptrend, and vice versa.

Market Data (JSON):
${JSON.stringify(aiData, null, 2)}

Based on this data, provide your analysis in JSON format ONLY:
{
  "action": "LONG" | "SHORT" | "HOLD",
  "confidence": 0-100,
  "reasoning": "Brief explanation including: trend direction, key indicator signals, and why this trade"
}

IMPORTANT: Respond with ONLY the JSON object, no additional text.`;

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${config.openRouterApiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/your-repo",
                "X-Title": "AI Futures Trading Bot",
            },
            body: JSON.stringify({
                model: config.aiModel,
                messages: [{ role: "user", content: prompt }],
            }),
        });

        if (!response.ok) throw new Error(`OpenRouter API error: ${response.statusText}`);

        const data = await response.json();
        const aiResponseText = data.choices[0].message.content;
        const jsonMatch = aiResponseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("AI did not return valid JSON");

        const aiDecision: AIResponse = JSON.parse(jsonMatch[0]);
        console.log(chalk.green(`✅ AI Decision: ${aiDecision.action}`));
        console.log(chalk.white(`   Confidence: ${aiDecision.confidence}%`));
        console.log(chalk.white(`   Reasoning: ${aiDecision.reasoning}`));
        return aiDecision;
    } catch (error: any) {
        console.error(chalk.red(`❌ AI Error: ${error.message}`));
        return { action: "HOLD", confidence: 0, reasoning: "AI service unavailable" };
    }
}

// ============================================================================
// TRADING EXECUTION
// ============================================================================

async function executeDecision(exchange: ccxt.Exchange, config: TradingConfig, marketData: MarketData, decision: AIResponse): Promise<void> {
    // Skip if HOLD or already in position
    if (decision.action === "HOLD") {
        console.log(chalk.yellow(`⏸  AI recommends HOLD - no action taken`));
        return;
    }

    if (marketData.position.side !== "none") {
        console.log(chalk.yellow(`⚠️  Already in ${marketData.position.side.toUpperCase()} position - skipping`));
        return;
    }

    const market = exchange.markets[config.symbol];
    const side = decision.action === "LONG" ? "buy" : "sell";
    const isLong = decision.action === "LONG";

    try {
        console.log(chalk.green(`\n🟢 OPENING ${decision.action} (${config.leverage}x)`));

        // Calculate position size
        const contracts = (config.positionSize * config.leverage) / marketData.currentPrice;
        const amountPrecision = market?.precision?.amount || 0.001;
        const amountTickSize = amountPrecision < 1 ? amountPrecision : Math.pow(10, -amountPrecision);
        const amountDecimals = amountPrecision < 1 ? -Math.log10(amountPrecision) : amountPrecision;

        let amount = Math.round(contracts / amountTickSize) * amountTickSize;
        amount = parseFloat(amount.toFixed(amountDecimals));
        amount = Math.max(amount, market?.limits?.amount?.min || 0.001);

        console.log(chalk.white(`   Size: ${amount} contracts (~$${(amount * marketData.currentPrice / config.leverage).toFixed(2)})`));

        // Open position
        const order = await exchange.createMarketOrder(config.symbol, side, amount);
        const entryPrice = order.average || marketData.currentPrice;

        // Calculate TP/SL based on actual entry
        const pricePrecision = market?.precision?.price || 0.01;
        const priceDecimals = pricePrecision < 1 ? -Math.log10(pricePrecision) : pricePrecision;
        const tpMultiplier = isLong ? (1 + config.takeProfitPercent / 100) : (1 - config.takeProfitPercent / 100);
        const slMultiplier = isLong ? (1 - config.stopLossPercent / 100) : (1 + config.stopLossPercent / 100);
        const takeProfitPrice = parseFloat((entryPrice * tpMultiplier).toFixed(priceDecimals));
        const stopLossPrice = parseFloat((entryPrice * slMultiplier).toFixed(priceDecimals));

        console.log(chalk.green(`✅ Position opened at $${entryPrice.toFixed(2)}`));
        console.log(chalk.green(`   TP: $${takeProfitPrice.toFixed(2)} (+${config.takeProfitPercent}%) | SL: $${stopLossPrice.toFixed(2)} (-${config.stopLossPercent}%)`));
        console.log(chalk.white(`   ${decision.reasoning}\n`));
    } catch (error: any) {
        console.error(chalk.red(`❌ Order failed: ${error.message}`));
    }
}

// ============================================================================
// POSITION MONITORING
// ============================================================================

/**
 * Checks if there's an open position for the given symbol
 * Returns the position object if found, null otherwise
 */
async function checkOpenPosition(exchange: ccxt.Exchange, symbol: string): Promise<any | null> {
    try {
        const positions = await exchange.fetchPositions([symbol]);
        const position = positions.find((p: any) => {
            const contracts = parseFloat(p.contracts || p.info?.positionAmt || 0);
            return p.symbol === symbol && Math.abs(contracts) > 0;
        });
        return position || null;
    } catch (error: any) {
        console.error(chalk.red(`   ⚠️  Error checking position: ${error.message}`));
        return null;
    }
}

async function monitorPositionUntilClosed(exchange: ccxt.Exchange, config: TradingConfig, entryPrice: number, action: string): Promise<void> {
    console.log(chalk.cyan(`\n⏳ Monitoring position until TP or SL is hit...`));

    let consecutiveNoPositionCount = 0;
    const requiredNoPositionCount = 3; // Require 3 consecutive checks showing no position

    while (true) {
        try {
            await new Promise((resolve) => setTimeout(resolve, 1000)); // Check every 1 second

            const position = await checkOpenPosition(exchange, config.symbol);

            if (!position) {
                consecutiveNoPositionCount++;
                console.log(chalk.gray(`   No position detected (${consecutiveNoPositionCount}/${requiredNoPositionCount})`));

                if (consecutiveNoPositionCount >= requiredNoPositionCount) {
                    console.log(chalk.green(`\n✅ Position confirmed closed!`));
                    console.log(chalk.green(`Resuming normal trading...\n`));
                    return; // Exit monitoring, let interval pick up next cycle
                }
                continue; // Keep checking
            }

            // Position found - reset counter
            consecutiveNoPositionCount = 0;

            const currentPrice = parseFloat(position.markPrice || position.info?.markPrice || 0);
            const pnl = parseFloat(position.unrealizedPnl || 0);
            const pnlPercent = parseFloat(position.percentage || 0);

            console.log(chalk.white(`   ${new Date().toLocaleTimeString()} | Entry: $${entryPrice.toFixed(2)} | Current: $${currentPrice.toFixed(2)} | PnL: ${pnlPercent > 0 ? '+' : ''}${pnlPercent.toFixed(2)}% ($${pnl.toFixed(2)})`));

            // Check if TP or SL level reached
            if (pnlPercent >= config.takeProfitPercent) {
                console.log(chalk.green(`\n🎯 Take Profit reached! (+${pnlPercent.toFixed(2)}%) - Closing position...`));

                const closeSide = action === "LONG" ? "sell" : "buy";
                const amount = parseFloat(position.contracts || position.info?.positionAmt || 0);

                try {
                    await exchange.createMarketOrder(config.symbol, closeSide, Math.abs(amount), { reduceOnly: true });
                    console.log(chalk.green(`✅ Position closed at profit!`));
                } catch (closeError: any) {
                    console.error(chalk.red(`   ⚠️  Failed to close: ${closeError.message}`));
                }

                console.log(chalk.green(`Resuming normal trading...\n`));
                return; // Exit monitoring
            }

            if (pnlPercent <= -config.stopLossPercent) {
                console.log(chalk.red(`\n🛑 Stop Loss reached! (${pnlPercent.toFixed(2)}%) - Closing position...`));

                const closeSide = action === "LONG" ? "sell" : "buy";
                const amount = parseFloat(position.contracts || position.info?.positionAmt || 0);

                try {
                    await exchange.createMarketOrder(config.symbol, closeSide, Math.abs(amount), { reduceOnly: true });
                    console.log(chalk.red(`✅ Position closed at loss!`));
                } catch (closeError: any) {
                    console.error(chalk.red(`   ⚠️  Failed to close: ${closeError.message}`));
                }

                console.log(chalk.green(`Resuming normal trading...\n`));
                return; // Exit monitoring
            }
        } catch (error: any) {
            console.error(chalk.red(`   ⚠️  Monitoring error: ${error.message}`));
            consecutiveNoPositionCount = 0; // Reset on error - don't exit on errors
        }
    }
}

// ============================================================================
// MAIN BOT
// ============================================================================

export async function startBot(config: TradingConfig = botConfig): Promise<void> {
    console.log(chalk.cyan.bold(`\n🤖 Starting AI-Powered Futures Trading Bot (Binance)...\n`));

    if (!config.openRouterApiKey) {
        console.error(chalk.red(`❌ OPENROUTER_API_KEY environment variable is required!`));
        process.exit(1);
    }

    const exchange = new ccxt.binance({
        apiKey: process.env.BINANCE_API_KEY,
        secret: process.env.BINANCE_SECRET,
        enableRateLimit: true,
        options: { defaultType: "future" },
    });

    await exchange.loadMarkets();
    console.log(chalk.green(`✅ Connected to Binance Futures\n`));

    // Set leverage
    try {
        await exchange.setLeverage(config.leverage, config.symbol);
        console.log(chalk.green(`✅ Leverage set to ${config.leverage}x\n`));
    } catch (error: any) {
        console.log(chalk.yellow(`⚠️  Could not set leverage: ${error.message}\n`));
    }

    console.log(chalk.cyan(`${"=".repeat(60)}`));
    console.log(chalk.cyan.bold(`⚙️  BOT CONFIGURATION`));
    console.log(chalk.cyan(`${"=".repeat(60)}`));
    console.log(`Exchange:       BINANCE FUTURES`);
    console.log(`Symbol:         ${config.symbol}`);
    console.log(`Leverage:       ${config.leverage}x`);
    console.log(`Position Size:  $${config.positionSize}`);
    console.log(`Check Interval: ${config.checkIntervalSeconds}s`);
    console.log(`AI Model:       ${config.aiModel}`);
    console.log(chalk.cyan(`${"=".repeat(60)}\n`));

    const mainLoop = async () => {
        try {
            // First, check if we have an open position to monitor
            const existingPosition = await checkOpenPosition(exchange, config.symbol);

            if (existingPosition) {
                const entryPrice = parseFloat(existingPosition.entryPrice || existingPosition.info?.entryPrice || 0);
                const side = existingPosition.side?.toLowerCase();
                const action = side === "long" ? "LONG" : "SHORT";

                console.log(chalk.cyan(`\n⏳ Existing position detected - monitoring until TP/SL...`));
                await monitorPositionUntilClosed(exchange, config, entryPrice, action);
                console.log(chalk.cyan(`\n⏳ Position closed, checking market for next trade...\n`));

                await new Promise((resolve) => setTimeout(resolve, 1000)); // Small delay
            } else {
                // No position - gather market data and consult AI
                const marketData = await gatherMarketData(exchange, config);
                const decision = await getAIDecision(marketData, config);
                await executeDecision(exchange, config, marketData, decision);

                if (decision.action === "HOLD") {
                    console.log(chalk.cyan(`\n⏳ Next check in ${config.checkIntervalSeconds} seconds...\n`));
                    await new Promise((resolve) => setTimeout(resolve, config.checkIntervalSeconds * 1000)); // Small delay
                }
            }
        } catch (error: any) {
            console.error(chalk.red(`❌ Error in cycle:`), error);
            console.log(chalk.yellow(`⚠️  Continuing to next cycle...\n`));
        }

        await mainLoop();
    };

    await mainLoop();
}

export async function runBot() {
    try {
        await startBot(botConfig);
    } catch (error) {
        console.error(chalk.red("❌ Bot failed to start:"), error);
        process.exit(1);
    }
}

if (require.main === module) {
    runBot().catch(console.error);
}
