/**
 * Exchange Connection and Operations
 */

import * as ccxt from "ccxt";
import { exchangeConfigs, defaultConfig } from "./config";

export type ExchangeName = keyof typeof exchangeConfigs;

export function initExchange(
    exchangeName: ExchangeName,
    testnet = false
): ccxt.Exchange {
    const config = exchangeConfigs[exchangeName];

    if (!config) {
        throw new Error(`Exchange ${exchangeName} not configured`);
    }

    const ExchangeClass = ccxt[
        exchangeName as keyof typeof ccxt
    ] as typeof ccxt.Exchange;

    const exchange = new ExchangeClass({
        ...defaultConfig,
        apiKey: config.apiKey,
        secret: config.secret,
        password: config.password,
        uid: config.uid,
        enableRateLimit: config.enableRateLimit
    });

    if (testnet && exchange.urls["test"]) {
        exchange.setSandboxMode(true);
    }

    return exchange;
}

export function getAvailableExchanges(): string[] {
    return Object.keys(ccxt.exchanges);
}

export function hasFeature(exchange: ccxt.Exchange, feature: string): boolean {
    return exchange.has[feature] === true;
}
