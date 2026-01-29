/**
 * Account Operations
 */

import * as ccxt from 'ccxt';

export async function fetchBalance(exchange: ccxt.Exchange) {
    try {
        return await exchange.fetchBalance();
    } catch (error) {
        console.error('Error fetching balance:', error);
        throw error;
    }
}

export async function getCurrencyBalance(exchange: ccxt.Exchange, currency: string) {
    try {
        const balance = await exchange.fetchBalance();
        return {
            free: balance.free[currency] || 0,
            used: balance.used[currency] || 0,
            total: balance.total[currency] || 0,
        };
    } catch (error) {
        console.error(`Error fetching balance for ${currency}:`, error);
        throw error;
    }
}

export async function fetchDepositAddress(
    exchange: ccxt.Exchange,
    currency: string,
    params = {}
) {
    try {
        return await exchange.fetchDepositAddress(currency, params);
    } catch (error) {
        console.error(`Error fetching deposit address for ${currency}:`, error);
        throw error;
    }
}

export async function fetchDeposits(
    exchange: ccxt.Exchange,
    currency?: string,
    since?: number,
    limit?: number
) {
    try {
        return await exchange.fetchDeposits(currency, since, limit);
    } catch (error) {
        console.error('Error fetching deposits:', error);
        throw error;
    }
}

export async function fetchWithdrawals(
    exchange: ccxt.Exchange,
    currency?: string,
    since?: number,
    limit?: number
) {
    try {
        return await exchange.fetchWithdrawals(currency, since, limit);
    } catch (error) {
        console.error('Error fetching withdrawals:', error);
        throw error;
    }
}

export async function withdraw(
    exchange: ccxt.Exchange,
    currency: string,
    amount: number,
    address: string,
    tag?: string,
    params = {}
) {
    try {
        return await exchange.withdraw(currency, amount, address, tag, params);
    } catch (error) {
        console.error('Error withdrawing funds:', error);
        throw error;
    }
}

export async function fetchTradingFees(exchange: ccxt.Exchange) {
    try {
        return await exchange.fetchTradingFees();
    } catch (error) {
        console.error('Error fetching trading fees:', error);
        throw error;
    }
}

export default {
    fetchBalance,
    getCurrencyBalance,
    fetchDepositAddress,
    fetchDeposits,
    fetchWithdrawals,
    withdraw,
    fetchTradingFees,
};
