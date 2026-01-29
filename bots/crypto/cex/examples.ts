/**
 * Usage Examples
 */

import { initExchange } from './exchange';
import * as marketData from './market-data';
import * as account from './account';

export async function exampleFetchTicker() {
    const exchange = initExchange('binance');
    const ticker = await marketData.fetchTicker(exchange, 'BTC/USDT');
    console.log('BTC/USDT Ticker:', ticker);
    return ticker;
}

export async function exampleFetchOrderBook() {
    const exchange = initExchange('binance');
    const orderbook = await marketData.fetchOrderBook(exchange, 'BTC/USDT', 10);
    console.log('Top 5 bids:', orderbook.bids.slice(0, 5));
    console.log('Top 5 asks:', orderbook.asks.slice(0, 5));
    return orderbook;
}

export async function exampleFetchOHLCV() {
    const exchange = initExchange('binance');
    const candles = await marketData.fetchOHLCV(exchange, 'BTC/USDT', '1h', undefined, 24);
    console.log(`Fetched ${candles.length} hourly candles`);
    return candles;
}

export async function exampleFetchBalance() {
    const exchange = initExchange('binance');
    const balance = await account.fetchBalance(exchange);
    console.log('Account Balance:', balance.total);
    return balance;
}

export default {
    exampleFetchTicker,
    exampleFetchOrderBook,
    exampleFetchOHLCV,
    exampleFetchBalance,
};
