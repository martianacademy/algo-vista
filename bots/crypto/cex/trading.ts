/**
 * Trading Operations
 */

import * as ccxt from 'ccxt';

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop-limit';

export async function createMarketOrder(
    exchange: ccxt.Exchange,
    symbol: string,
    side: OrderSide,
    amount: number,
    params = {}
) {
    try {
        return await exchange.createOrder(symbol, 'market', side, amount, undefined, params);
    } catch (error) {
        console.error(`Error creating market order:`, error);
        throw error;
    }
}

export async function createLimitOrder(
    exchange: ccxt.Exchange,
    symbol: string,
    side: OrderSide,
    amount: number,
    price: number,
    params = {}
) {
    try {
        return await exchange.createOrder(symbol, 'limit', side, amount, price, params);
    } catch (error) {
        console.error(`Error creating limit order:`, error);
        throw error;
    }
}

export async function cancelOrder(
    exchange: ccxt.Exchange,
    orderId: string,
    symbol: string
) {
    try {
        return await exchange.cancelOrder(orderId, symbol);
    } catch (error) {
        console.error(`Error canceling order ${orderId}:`, error);
        throw error;
    }
}

export async function fetchOpenOrders(
    exchange: ccxt.Exchange,
    symbol?: string,
    since?: number,
    limit?: number
) {
    try {
        return await exchange.fetchOpenOrders(symbol, since, limit);
    } catch (error) {
        console.error('Error fetching open orders:', error);
        throw error;
    }
}

export async function fetchOrder(
    exchange: ccxt.Exchange,
    orderId: string,
    symbol: string
) {
    try {
        return await exchange.fetchOrder(orderId, symbol);
    } catch (error) {
        console.error(`Error fetching order ${orderId}:`, error);
        throw error;
    }
}

export async function cancelAllOrders(exchange: ccxt.Exchange, symbol?: string) {
    try {
        const orders = await exchange.fetchOpenOrders(symbol);
        const results = await Promise.all(
            orders.map((order: any) => exchange.cancelOrder(order.id, order.symbol))
        );
        return results;
    } catch (error) {
        console.error('Error canceling all orders:', error);
        throw error;
    }
}

export default {
    createMarketOrder,
    createLimitOrder,
    cancelOrder,
    fetchOpenOrders,
    fetchOrder,
    cancelAllOrders,
};
