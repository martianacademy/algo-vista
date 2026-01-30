# Docker Deployment Guide

## Prerequisites

- Docker installed
- Docker Compose installed
- `.env` file with API credentials (see `.env.example`)

## Quick Start

### 1. Setup Environment Variables

```bash
cp .env.example .env
# Edit .env with your actual API keys and configuration
```

### 2. Build and Run All Services

```bash
docker-compose up -d
```

This will start:

- **Web App** on `http://localhost:3000`
- **Futures Trading Bot** (running in background)

### 3. View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f bot-futures
docker-compose logs -f web
```

## Individual Service Management

### Run Only Web App

```bash
docker-compose up -d web
```

### Run Only Trading Bot

```bash
docker-compose up -d bot-futures
```

### Stop All Services

```bash
docker-compose down
```

## Building Individual Docker Images

### Build Web App

```bash
docker build -t algo-vista:latest .
```

### Run Web App

```bash
docker run -p 3000:3000 --env-file .env algo-vista:latest
```

### Run Futures Bot

```bash
docker run --env-file .env algo-vista:latest \
  node bots/crypto/cex/auto-trading/auto-trading-futures-binance.js
```

## Environment Variables

Required in `.env` file:

- `BINANCE_API_KEY` - Your Binance API key
- `BINANCE_SECRET` - Your Binance secret
- `OPENROUTER_API_KEY` - OpenRouter API key for AI
- `SYMBOL` - Trading symbol (e.g., BTC/USDT:USDT)
- `POSITION_SIZE` - Position size in USDT
- `LEVERAGE` - Leverage multiplier
- `STOP_LOSS_PERCENT` - Stop loss percentage
- `TAKE_PROFIT_PERCENT` - Take profit percentage

## Configuration

### Change Trading Symbol

Edit `.env`:

```env
SYMBOL=ETH/USDT:USDT
```

Then restart:

```bash
docker-compose restart bot-futures
```

### Change Position Size & Leverage

Edit `.env`:

```env
POSITION_SIZE=20
LEVERAGE=5
```

Then restart:

```bash
docker-compose restart bot-futures
```

## Troubleshooting

### Check Container Status

```bash
docker-compose ps
```

### View Real-time Logs

```bash
docker-compose logs -f bot-futures
```

### Restart a Service

```bash
docker-compose restart bot-futures
```

### Rebuild After Code Changes

```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## Production Deployment

For production, consider:

1. Use a reverse proxy (Nginx, Caddy)
2. Enable HTTPS
3. Set up log rotation
4. Use Docker secrets for credentials
5. Configure restart policies
6. Set up monitoring (Prometheus, Grafana)

### Example Production docker-compose.yml additions:

```yaml
services:
  bot-futures:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 512M
```

## Security Notes

- Never commit `.env` file with real credentials
- Use Docker secrets in production
- Restrict API key permissions on Binance
- Enable IP whitelist on Binance API settings
- Use read-only volumes where possible
