# Algo Vista Bots

Standalone trading bot project supporting multiple markets and platforms.

## Structure

```
bots/
├── crypto/
│   ├── cex/    # Centralized Exchange Trading (CCXT)
│   └── dex/    # Decentralized Exchange Trading
├── mt5/        # MetaTrader 5 Trading
├── stock/      # Stock Market Trading
└── shared/     # Shared utilities
```

## Installation

```bash
cd bots
npm install
```

## Configuration

1. Copy the environment template:

```bash
cp .env.example .env
```

2. Add your API credentials to `.env`

## Usage

### Development Mode

```bash
npm run dev
```

### Type Checking

```bash
npm run type-check
```

### Build

```bash
npm run build
```

### Production

```bash
npm start
```

## CEX (Centralized Exchange) Module

See [crypto/cex/README.md](crypto/cex/README.md) for detailed documentation on:

- Exchange setup
- Market data fetching
- Order placement
- Account management
- Trading strategies

## Environment Variables

All sensitive credentials should be stored in `.env` file (never commit this file).

Required variables:

- `BINANCE_API_KEY` / `BINANCE_SECRET`
- `COINBASE_API_KEY` / `COINBASE_SECRET` / `COINBASE_PASSWORD`
- `KRAKEN_API_KEY` / `KRAKEN_SECRET`
- `BYBIT_API_KEY` / `BYBIT_SECRET`

## Security

⚠️ **Important:**

- Never commit API keys
- Use IP whitelisting on exchanges
- Enable 2FA on all accounts
- Start with testnet/sandbox mode
- Use separate keys for different bots

## License

MIT
