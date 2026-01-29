/**
 * CEX Configuration
 * Store your exchange API credentials here (use environment variables)
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from bots directory regardless of where script is run from
config({ path: resolve(__dirname, '../../.env') });
import dotenv from "dotenv";

dotenv.config();

export interface ExchangeConfig {
    apiKey: string;
    secret: string;
    password?: string;
    uid?: string;
    enableRateLimit: boolean;
    sandbox?: boolean;
}

export const exchangeConfigs: Record<string, ExchangeConfig> = {
    binance: {
        apiKey: process.env.BINANCE_API_KEY || "",
        secret: process.env.BINANCE_SECRET || "",
        enableRateLimit: true,
        sandbox: false
    },
    coinbase: {
        apiKey: process.env.COINBASE_API_KEY || "",
        secret: process.env.COINBASE_SECRET || "",
        password: process.env.COINBASE_PASSWORD || "",
        enableRateLimit: true,
        sandbox: false
    },
    kraken: {
        apiKey: process.env.KRAKEN_API_KEY || "",
        secret: process.env.KRAKEN_SECRET || "",
        enableRateLimit: true,
        sandbox: false
    },
    bybit: {
        apiKey: process.env.BYBIT_API_KEY || "",
        secret: process.env.BYBIT_SECRET || "",
        enableRateLimit: true,
        sandbox: false
    },
    okx: {
        apiKey: process.env.OKX_API_KEY || "",
        secret: process.env.OKX_SECRET || "",
        password: process.env.OKX_PASSWORD || "",
        enableRateLimit: true,
        sandbox: false
    },
    xt: {
        apiKey: process.env.XT_API_KEY || "",
        secret: process.env.XT_SECRET_KEY || "",
        enableRateLimit: true,
        sandbox: false
    },
    bitmart: {
        apiKey: process.env.BITMART_API_KEY || "",
        secret: process.env.BITMART_SECRET || "",
        password: process.env.BITMART_PASSWORD || "",
        uid: process.env.BITMART_UID || "",
        enableRateLimit: true,
        sandbox: false
    },
    p2pb2b: {
        apiKey: process.env.P2PB2B_API_KEY || "",
        secret: process.env.P2PB2B_SECRET || "",
        enableRateLimit: true,
        sandbox: false
    }
};

console.log(exchangeConfigs)

export const defaultConfig = {
    enableRateLimit: true,
    timeout: 30000,
    recvWindow: 10000
};
