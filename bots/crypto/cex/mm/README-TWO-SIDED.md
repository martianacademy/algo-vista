# Two-Sided Market Maker Bot

## Overview

This bot places orders on **BOTH sides** (BID and ASK) simultaneously. When **any order** on either side gets filled, the bot automatically cancels and replaces **ALL orders on BOTH sides**.

## Key Features

✅ **Synchronized Order Management** - Both sides are always fresh  
✅ **Instant Reaction** - Any fill triggers complete refresh  
✅ **Independent Amounts** - Configure different amounts for BID and ASK  
✅ **Drift Detection** - Auto-refresh when prices move too far  
✅ **Robust Error Handling** - Maintains state and recovers automatically

## Configuration

### Environment Variables

```bash
# Exchange and Symbol
EXCHANGE=xt
SYMBOL=ORBD/USDT

# Order Amounts (in quote currency, e.g., USDT)
BID_TOTAL_QUOTE_AMOUNT=5.5    # Total amount for all BID orders
ASK_TOTAL_QUOTE_AMOUNT=5.5    # Total amount for all ASK orders
TOTAL_QUOTE_AMOUNT=5.5         # Fallback for both sides if above not set

# Spread and Distribution
SPREAD_PERCENT=20              # Spread range (e.g., 20 = 20%)
NUMBER_OF_ORDERS=20            # Orders per side (20 BID + 20 ASK = 40 total)

# Price Reference
PRICE_REFERENCE=mid            # Options: first_ask, first_bid, mid, best

# Drift and Monitoring
DRIFT_THRESHOLD_PERCENT=20     # Refresh when price drifts this much
MONITOR_INTERVAL_SECONDS=1     # Check orders every X seconds
```

### Price Reference Options

- `mid` - Use mid-market price (average of bid/ask) - **Recommended for two-sided**
- `first_bid` - Use highest bid price
- `first_ask` - Use lowest ask price
- `best` - Auto-select based on side (not recommended for two-sided)

## How It Works

### Initial Placement

1. Bot places `NUMBER_OF_ORDERS` on BID side with `BID_TOTAL_QUOTE_AMOUNT`
2. Bot places `NUMBER_OF_ORDERS` on ASK side with `ASK_TOTAL_QUOTE_AMOUNT`
3. Orders are distributed across the `SPREAD_PERCENT` range

### Monitoring Loop (every second)

The bot continuously monitors for:

1. **Fills** - If ANY order fills on either side → cancel all + replace all
2. **Missing Orders** - If either side has missing orders → refresh both
3. **Price Drift** - If either side drifts beyond threshold → refresh both

### Fill Detection & Refresh

When an order executes:

```
BID ORDER FILLS:
✓ Detect fill
✓ Cancel ALL remaining BID orders
✓ Cancel ALL remaining ASK orders
✓ Verify both sides clear
✓ Place fresh BID orders
✓ Place fresh ASK orders

ASK ORDER FILLS:
✓ Same process as above
```

## Usage

### Run the Bot

```bash
# With environment variables
EXCHANGE=xt \
SYMBOL=ORBD/USDT \
BID_TOTAL_QUOTE_AMOUNT=10 \
ASK_TOTAL_QUOTE_AMOUNT=10 \
SPREAD_PERCENT=20 \
NUMBER_OF_ORDERS=20 \
npx tsx bots/crypto/cex/mm/mm-mono-side-v2.ts
```

### Or use a .env file

```bash
# Create .env file with your config
cp .env.example .env

# Edit .env with your values
nano .env

# Run the bot
npx tsx bots/crypto/cex/mm/mm-mono-side-v2.ts
```

## Example Output

```
============================================================
🤖 TWO-SIDED MARKET MAKER BOT
============================================================
Exchange:         XT
Symbol:           ORBD/USDT
BID Amount:       5.5
ASK Amount:       5.5
Spread:           20%
Orders per side:  20
Price Ref:        mid
Drift Thresh:     20%
Monitor Int:      1s
============================================================

============================================================
📤 PLACING ORDERS ON BOTH SIDES
============================================================

📊 Placing BID orders...
   ✅ Order 1 Placed [BID]: Price: 0.00001200 Size: 458.33333333 ORBD
   ✅ Order 2 Placed [BID]: Price: 0.00001195 Size: 459.41559815 ORBD
   ...
✅ Placed 20 BID orders

📊 Placing ASK orders...
   ✅ Order 1 Placed [ASK]: Price: 0.00001505 Size: 365.63876652 ORBD
   ✅ Order 2 Placed [ASK]: Price: 0.00001510 Size: 364.23841060 ORBD
   ...
✅ Placed 20 ASK orders

============================================================
✅ BOTH SIDES READY - Total: 40 orders
============================================================

🔄 Monitoring started - checking every 1 second(s)...

💓 [10:30:45] Monitoring... 20 BID + 20 ASK orders, drift: BID 0.50% / ASK 0.45%

============================================================
💰 FILL DETECTED!
============================================================
💰 TRADE FILL DETECTED - BID
============================================================
🕐 Time:     1/29/2026, 10:31:02
📊 Filled:   1 order(s)
🆔 IDs:      abc123456789...
============================================================

🔄 Refreshing ALL orders on BOTH sides...

🗑️  Cancelling ALL orders on BOTH sides...
✅ Cancelled 39 order(s) total

✅ Both sides clear - placing fresh orders...

[Places fresh orders on both sides...]
```

## Best Practices

### 1. Start with Small Amounts

Test with small amounts first:

```bash
BID_TOTAL_QUOTE_AMOUNT=1
ASK_TOTAL_QUOTE_AMOUNT=1
```

### 2. Adjust Spread Based on Volatility

- Low volatility: 5-10%
- Medium volatility: 10-20%
- High volatility: 20-50%

### 3. Monitor Your Balance

The bot will auto-adjust if you don't have enough balance, but it's better to ensure you have:

- Enough quote currency (USDT) for BID orders
- Enough base currency (ORBD) for ASK orders

### 4. Set Appropriate Drift Threshold

- Tight markets: Set drift threshold = spread
- Volatile markets: Set drift threshold > spread to avoid too many refreshes

### 5. Watch for Exchange Rate Limits

If you see rate limit errors, increase `MONITOR_INTERVAL_SECONDS` to 2 or 3 seconds.

## Troubleshooting

### "Insufficient balance" errors

Check your available balance:

- BID orders need quote currency (USDT)
- ASK orders need base currency (ORBD)

### Orders not refreshing after fill

The bot now properly tracks state. If you see this:

1. Check console for error messages
2. Verify orders are actually filling (check exchange)
3. Ensure `MONITOR_INTERVAL_SECONDS` is not too high

### Too many order refreshes

If orders refresh too frequently:

1. Increase `DRIFT_THRESHOLD_PERCENT`
2. Check if `SPREAD_PERCENT` is too small
3. Consider increasing `MONITOR_INTERVAL_SECONDS`

## Comparison: One-Sided vs Two-Sided

| Feature       | One-Sided (Legacy)          | Two-Sided (New)                               |
| ------------- | --------------------------- | --------------------------------------------- |
| Sides Active  | BID **or** ASK              | BID **and** ASK                               |
| Fill Reaction | Refresh same side           | Refresh **both** sides                        |
| Config        | `side` + `totalQuoteAmount` | `bidTotalQuoteAmount` + `askTotalQuoteAmount` |
| Use Case      | Directional trading         | True market making                            |

## Notes

- The bot uses the `placeMonoSideOrders` function internally for each side
- All previous fixes (state management, recovery, etc.) are included
- The monitoring interval applies to both sides equally
- Cancellations use batch operations when supported by the exchange

## Support

For issues or questions, check the main README or create an issue in the repository.
