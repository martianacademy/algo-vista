/**
 * Market Making Strategy - Large Order Detection
 * Detects large orders in the order book and places orders accordingly to capture spread
 */

import * as ccxt from 'ccxt';
import { initExchange, type ExchangeName } from '../exchange';
import * as marketData from '../market-data';
import * as trading from '../trading';
import * as account from '../account';

export interface LargeOrderMMConfig {
    exchange: ExchangeName;
    symbol: string;
    largeOrderThreshold: number;      // Minimum order size to be considered "large" (in base currency)
    spreadMultiplier: number;         // Multiply normal spread by this when large order detected
    orderAmount: number;              // Amount per order in base currency
    maxDistance: number;              // Max distance from mid price to place orders (%)
    refreshInterval: number;          // How often to check order book (ms)
    minSpread: number;                // Minimum spread to maintain (%)
}

export interface LargeOrder {
    side: 'bid' | 'ask';
    price: number;
    amount: number;
    distance: number;                 // Distance from mid price (%)
}

export interface LargeOrderMMState {
    midPrice: number;
    largeOrders: LargeOrder[];
    activeOrders: string[];
    totalProfit: number;
    detectedCount: number;
    isRunning: boolean;
}

export class LargeOrderMarketMaker {
    private config: LargeOrderMMConfig;
    private exchange: ccxt.Exchange;
    private state: LargeOrderMMState;
    private intervalId?: NodeJS.Timeout;

    constructor(config: LargeOrderMMConfig) {
        this.config = config;
        this.exchange = initExchange(config.exchange);
        this.state = {
            midPrice: 0,
            largeOrders: [],
            activeOrders: [],
            totalProfit: 0,
            detectedCount: 0,
            isRunning: false,
        };
    }

    /**
     * Start the market making bot
     */
    async start(): Promise<void> {
        console.log(`🔍 Starting Large Order Market Maker for ${this.config.symbol}`);
        this.state.isRunning = true;

        // Main loop
        await this.runLoop();

        // Set up periodic refresh
        this.intervalId = setInterval(
            () => this.runLoop(),
            this.config.refreshInterval
        );
    }

    /**
     * Stop the market making bot
     */
    async stop(): Promise<void> {
        console.log('🛑 Stopping Large Order Market Maker...');
        this.state.isRunning = false;

        if (this.intervalId) {
            clearInterval(this.intervalId);
        }

        // Cancel all open orders
        await this.cancelAllOrders();

        console.log('✅ Large Order Market Maker stopped');
    }

    /**
     * Main execution loop
     */
    private async runLoop(): Promise<void> {
        if (!this.state.isRunning) return;

        try {
            // Update market data
            await this.updateMarketData();

            // Detect large orders
            await this.detectLargeOrders();

            // Place strategic orders based on large orders
            if (this.state.largeOrders.length > 0) {
                await this.placeStrategicOrders();
            } else {
                // No large orders, maintain minimal spread
                await this.maintainMinimalSpread();
            }

            // Log status
            this.logStatus();
        } catch (error) {
            console.error('Error in large order market making loop:', error);
        }
    }

    /**
     * Update current market data
     */
    private async updateMarketData(): Promise<void> {
        const ticker = await marketData.fetchTicker(this.exchange, this.config.symbol);

        if (ticker.bid && ticker.ask) {
            this.state.midPrice = (ticker.bid + ticker.ask) / 2;
        } else {
            this.state.midPrice = ticker.last || 0;
        }
    }

    /**
     * Detect large orders in the order book
     */
    private async detectLargeOrders(): Promise<void> {
        const orderbook = await marketData.fetchOrderBook(this.exchange, this.config.symbol, 50);

        this.state.largeOrders = [];

        // Check bids for large orders
        for (const [price, amount] of orderbook.bids) {
            if (amount >= this.config.largeOrderThreshold) {
                const distance = ((this.state.midPrice - price) / this.state.midPrice) * 100;

                if (distance <= this.config.maxDistance) {
                    this.state.largeOrders.push({
                        side: 'bid',
                        price,
                        amount,
                        distance,
                    });
                }
            }
        }

        // Check asks for large orders
        for (const [price, amount] of orderbook.asks) {
            if (amount >= this.config.largeOrderThreshold) {
                const distance = ((price - this.state.midPrice) / this.state.midPrice) * 100;

                if (distance <= this.config.maxDistance) {
                    this.state.largeOrders.push({
                        side: 'ask',
                        price,
                        amount,
                        distance,
                    });
                }
            }
        }

        // Update detection count
        if (this.state.largeOrders.length > 0) {
            this.state.detectedCount++;
            console.log(`🎯 Detected ${this.state.largeOrders.length} large orders`);
        }
    }

    /**
     * Place strategic orders based on detected large orders
     */
    private async placeStrategicOrders(): Promise<void> {
        // Cancel existing orders first
        await this.cancelAllOrders();

        for (const largeOrder of this.state.largeOrders) {
            try {
                if (largeOrder.side === 'bid') {
                    // Large bid detected - place ask order slightly above it to capture spread
                    const askPrice = largeOrder.price * (1 + (this.config.minSpread / 100) * this.config.spreadMultiplier);

                    const order = await trading.createLimitOrder(
                        this.exchange,
                        this.config.symbol,
                        'sell',
                        this.config.orderAmount,
                        askPrice
                    );

                    this.state.activeOrders.push(order.id);
                    console.log(`✅ Placed ASK above large bid: ${this.config.orderAmount} @ ${askPrice.toFixed(8)}`);

                } else {
                    // Large ask detected - place bid order slightly below it to capture spread
                    const bidPrice = largeOrder.price * (1 - (this.config.minSpread / 100) * this.config.spreadMultiplier);

                    const order = await trading.createLimitOrder(
                        this.exchange,
                        this.config.symbol,
                        'buy',
                        this.config.orderAmount,
                        bidPrice
                    );

                    this.state.activeOrders.push(order.id);
                    console.log(`✅ Placed BID below large ask: ${this.config.orderAmount} @ ${bidPrice.toFixed(8)}`);
                }
            } catch (error) {
                console.error('Error placing strategic order:', error);
            }
        }
    }

    /**
     * Maintain minimal spread when no large orders detected
     */
    private async maintainMinimalSpread(): Promise<void> {
        // Cancel existing orders
        await this.cancelAllOrders();

        const halfSpread = this.config.minSpread / 2 / 100;

        try {
            // Place bid
            const bidPrice = this.state.midPrice * (1 - halfSpread);
            const bidOrder = await trading.createLimitOrder(
                this.exchange,
                this.config.symbol,
                'buy',
                this.config.orderAmount,
                bidPrice
            );
            this.state.activeOrders.push(bidOrder.id);

            // Place ask
            const askPrice = this.state.midPrice * (1 + halfSpread);
            const askOrder = await trading.createLimitOrder(
                this.exchange,
                this.config.symbol,
                'sell',
                this.config.orderAmount,
                askPrice
            );
            this.state.activeOrders.push(askOrder.id);

            console.log(`📊 Minimal spread orders placed: BID @ ${bidPrice.toFixed(8)}, ASK @ ${askPrice.toFixed(8)}`);
        } catch (error) {
            console.error('Error maintaining minimal spread:', error);
        }
    }

    /**
     * Cancel all open orders
     */
    private async cancelAllOrders(): Promise<void> {
        if (this.state.activeOrders.length === 0) return;

        try {
            await trading.cancelAllOrders(this.exchange, this.config.symbol);
            this.state.activeOrders = [];
        } catch (error) {
            console.error('Error canceling orders:', error);
        }
    }

    /**
     * Log current status
     */
    private logStatus(): void {
        console.log('\n📊 Large Order MM Status:');
        console.log(`   Symbol: ${this.config.symbol}`);
        console.log(`   Mid Price: ${this.state.midPrice.toFixed(8)}`);
        console.log(`   Large Orders Detected: ${this.state.largeOrders.length}`);
        console.log(`   Total Detections: ${this.state.detectedCount}`);
        console.log(`   Active Orders: ${this.state.activeOrders.length}`);
        console.log(`   Total Profit: ${this.state.totalProfit.toFixed(2)}`);

        if (this.state.largeOrders.length > 0) {
            console.log('   Large Orders:');
            this.state.largeOrders.forEach(order => {
                console.log(`     ${order.side.toUpperCase()}: ${order.amount.toFixed(4)} @ ${order.price.toFixed(8)} (${order.distance.toFixed(2)}% from mid)`);
            });
        }
        console.log('');
    }

    /**
     * Get current state
     */
    getState(): LargeOrderMMState {
        return { ...this.state };
    }

    /**
     * Get configuration
     */
    getConfig(): LargeOrderMMConfig {
        return { ...this.config };
    }
}

/**
 * Create and start a large order detection market maker
 */
export async function runLargeOrderMM(config: LargeOrderMMConfig): Promise<LargeOrderMarketMaker> {
    const mm = new LargeOrderMarketMaker(config);
    await mm.start();
    return mm;
}

/**
 * Example usage
 */
export async function exampleLargeOrderMM() {
    const config: LargeOrderMMConfig = {
        exchange: 'binance',
        symbol: 'BTC/USDT',
        largeOrderThreshold: 1.0,     // 1 BTC minimum to be considered "large"
        spreadMultiplier: 1.5,        // 1.5x normal spread
        orderAmount: 0.01,            // 0.01 BTC per order
        maxDistance: 2.0,             // Only consider orders within 2% of mid
        refreshInterval: 10000,       // Check every 10 seconds
        minSpread: 0.1,               // 0.1% minimum spread
    };

    const mm = await runLargeOrderMM(config);

    // Run for a period then stop
    setTimeout(async () => {
        await mm.stop();
        console.log('Final state:', mm.getState());
    }, 300000); // Run for 5 minutes

    return mm;
}

export default { LargeOrderMarketMaker, runLargeOrderMM, exampleLargeOrderMM };
