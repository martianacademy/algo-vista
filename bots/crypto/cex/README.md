# CEX Trading Module

Centralized exchange trading powered by [CCXT](https://github.com/ccxt/ccxt).

## Quick Start

```bash
cd /Users/suru.martian/Documents/GitHub/algo-vista/bots
npm install
npm run dev
```

## Configuration

1. Copy environment file:

```bash
cp .env.example .env
```

2. Add your API credentials to `.env`

## Usage

```typescript
import { initExchange } from "./exchange";
import * as marketData from "./market-data";

const exchange = initExchange("binance");
const ticker = await marketData.fetchTicker(exchange, "BTC/USDT");
console.log("BTC Price:", ticker.last);
```

## Features

- ✅ Exchange initialization (Binance, Coinbase, Kraken, Bybit, OKX)
- ✅ Market data (tickers, orderbooks, OHLCV, trades)
- ✅ Trading operations (market/limit orders)
- ✅ Account management (balances, deposits, withdrawals)
- ✅ TypeScript support with full type safety
- ✅ Environment-based configuration

## Security

⚠️ Never commit API keys. Use `.env` file (already in `.gitignore`)

## Documentation

See [main bots README](../../README.md) for full documentation.
