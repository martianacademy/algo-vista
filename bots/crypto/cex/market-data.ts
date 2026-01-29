/**
 * Market Data Operations
 */

import * as ccxt from 'ccxt';

export async function fetchTicker(exchange: ccxt.Exchange, symbol: string) {
    try {
        return await exchange.fetchTicker(symbol);
    } catch (error) {
        console.error(`Error fetching ticker for ${symbol}:`, error);
        throw error;
    }
}

export async function fetchOrderBook(exchange: ccxt.Exchange, symbol: string, limit = 20) {
    try {
        return await exchange.fetchOrderBook(symbol, limit);
    } catch (error) {
        console.error(`Error fetching orderbook for ${symbol}:`, error);
        throw error;
    }
}

export async function fetchOHLCV(
    exchange: ccxt.Exchange,
    symbol: string,
    timeframe: string = '1h',
    since?: number,
    limit?: number
) {
    try {
        return await exchange.fetchOHLCV(symbol, timeframe, since, limit);
    } catch (error) {
        console.error(`Error fetching OHLCV for ${symbol}:`, error);
        throw error;
    }
}

export async function fetchTrades(
    exchange: ccxt.Exchange,
    symbol: string,
    since?: number,
    limit?: number
) {
    try {
        return await exchange.fetchTrades(symbol, since, limit);
    } catch (error) {
        console.error(`Error fetching trades for ${symbol}:`, error);
        throw error;
    }
}

export async function fetchMarkets(exchange: ccxt.Exchange) {
    try {
        return await exchange.fetchMarkets();
    } catch (error) {
        console.error('Error fetching markets:', error);
        throw error;
    }
}

export async function getMarketInfo(exchange: ccxt.Exchange, symbol: string) {
    try {
        await exchange.loadMarkets();
        return exchange.market(symbol);
    } catch (error) {
        console.error(`Error getting market info for ${symbol}:`, error);
        throw error;
    }
}

export default {
    fetchTicker,
    fetchOrderBook,
    fetchOHLCV,
    fetchTrades,
    fetchMarkets,
    getMarketInfo,
};
