/**
 * CCXT Type Definitions
 * Simplified types for CCXT library
 */

declare module 'ccxt' {
    export class Exchange {
        constructor(config?: any);

        id: string;
        name: string;
        urls: Record<string, any>;
        has: Record<string, boolean | string>;
        markets: Record<string, any>;

        loadMarkets(): Promise<any>;
        fetchTicker(symbol: string): Promise<any>;
        fetchOrderBook(symbol: string, limit?: number): Promise<any>;
        fetchOHLCV(symbol: string, timeframe?: string, since?: number, limit?: number): Promise<any[]>;
        fetchTrades(symbol: string, since?: number, limit?: number): Promise<any[]>;
        fetchMarkets(): Promise<any[]>;
        fetchBalance(): Promise<any>;
        fetchOrder(id: string, symbol: string): Promise<any>;
        fetchOpenOrders(symbol?: string, since?: number, limit?: number): Promise<any[]>;
        fetchDeposits(code?: string, since?: number, limit?: number): Promise<any[]>;
        fetchWithdrawals(code?: string, since?: number, limit?: number): Promise<any[]>;
        fetchDepositAddress(code: string, params?: any): Promise<any>;
        fetchTradingFees(): Promise<any>;

        createOrder(symbol: string, type: string, side: string, amount: number, price?: number, params?: any): Promise<any>;
        cancelOrder(id: string, symbol: string): Promise<any>;
        cancelOrders(ids: string[], symbol?: string, params?: any): Promise<any>;
        withdraw(code: string, amount: number, address: string, tag?: string, params?: any): Promise<any>;
        cancelAllOrders(symbol?: string, params?: any): Promise<any>;

        setSandboxMode(enabled: boolean): void;
        market(symbol: string): any;
    }

    export const exchanges: string[];
    export const version: string;

    // Exchange classes
    export class binance extends Exchange { }
    export class coinbase extends Exchange { }
    export class kraken extends Exchange { }
    export class bybit extends Exchange { }
    export class okx extends Exchange { }
    export class xt extends Exchange { }
    export class bitmart extends Exchange { }
    export class p2pb2b extends Exchange { }
}
