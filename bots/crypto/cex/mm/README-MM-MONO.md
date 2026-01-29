# Mono-Side Market Maker Bot

A professional-grade cryptocurrency market making bot that places limit orders on one side of the order book (either BID or ASK).

## 🎯 Overview

This bot implements a **mono-side market making strategy** where you run separate bot instances for buying (BID) and selling (ASK). Each instance:

- Places multiple limit orders distributed across a configurable price spread
- Monitors orders continuously for fills and market drift
- Automatically refreshes orders when needed
- Handles balance adjustments dynamically

## 🏗️ Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Mono-Side Market Maker                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Configuration Layer                                        │
│  └── Environment Variables → MonoSideMMConfig              │
│                                                             │
│  Exchange Layer (CCXT)                                     │
│  ├── Balance Checking                                      │
│  ├── Order Placement (Parallel)                           │
│  ├── Order Cancellation (Batch)                           │
│  └── Market Data Fetching                                 │
│                                                             │
│  Strategy Layer                                            │
│  ├── Price Reference Selection                            │
│  ├── Order Distribution Calculator                        │
│  ├── Precision Handler                                    │
│  └── Drift Detection                                      │
│                                                             │
│  Monitoring Loop                                           │
│  ├── Fill Detection                                       │
│  ├── Order Count Verification                             │
│  ├── Drift Threshold Checking                             │
│  └── Auto-refresh Logic                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 📊 How It Works

### 1. **Initialization Phase**

```
Start Bot
   ↓
Load Configuration from ENV vars
   ↓
Initialize Exchange (CCXT)
   ↓
Check Account Balance
   ↓
Fetch Market Info (precision, limits)
   ↓
Get Reference Price
```

### 2. **Order Placement**

```
Calculate Order Distribution
   ↓
For each order:
  - Calculate price with spread offset
  - Calculate amount (total / numberOfOrders)
  - Round to exchange precision
  - Validate against min amounts
   ↓
Place all orders in PARALLEL (Promise.all)
   ↓
Store order IDs for tracking
```

**Order Distribution Example:**

```
Spread: 20%, Orders: 5, Side: ASK, Price: $1.00

Order 1: $1.02  (2% above)
Order 2: $1.06  (6% above)
Order 3: $1.10  (10% above)
Order 4: $1.14  (14% above)
Order 5: $1.18  (18% above)
```

### 3. **Monitoring Loop**

```
Every X seconds (configurable):
   ↓
Fetch all open orders
   ↓
Filter by our side (buy/sell)
   ↓
┌─────────────────────────────┐
│ Priority 1: No Orders?      │
│ → Place new orders          │
└─────────────────────────────┘
   ↓ Orders exist
┌─────────────────────────────┐
│ Priority 2: Any Fills?      │
│ → Cancel remaining orders   │
│ → Wait for side to clear    │
│ → Place fresh orders        │
└─────────────────────────────┘
   ↓ No fills
┌─────────────────────────────┐
│ Priority 3: Check Issues    │
│ - Count < required?         │
│ - Drift > threshold?        │
│ → Cancel & replace all      │
└─────────────────────────────┘
   ↓ All stable
┌─────────────────────────────┐
│ Priority 4: Heartbeat       │
│ → Log status every ~10s     │
└─────────────────────────────┘
```

### 4. **Fill Handling**

When any order fills:

```
Detect Fill
   ↓
Cancel remaining orders on that side
   ↓
Re-fetch to verify side is clear
   ↓
If clear: Place new orders
If not clear: Wait for next cycle
```

### 5. **Drift Detection**

Orders are refreshed if the closest order (highest BID or lowest ASK) drifts too far from the current market price:

```
Current Reference Price: $1.00
Drift Threshold: 20%

For BID side:
  Highest BID: $0.75
  Distance: 25% below
  → Drift exceeded → Refresh orders

For ASK side:
  Lowest ASK: $1.28
  Distance: 28% above
  → Drift exceeded → Refresh orders
```

## ⚙️ Configuration

### MonoSideMMConfig Interface

```typescript
interface MonoSideMMConfig {
  exchange: string; // Exchange name
  symbol: string; // Trading pair (e.g., "ORBD/USDT")
  side: "bid" | "ask"; // Order side
  totalQuoteAmount: number; // Total amount in quote currency
  spreadPercent: number; // Spread percentage
  numberOfOrders: number; // Number of orders to place
  priceReference?: string; // Price reference type
  driftThresholdPercent?: number; // Drift threshold for refresh
  monitorIntervalSeconds?: number; // Check frequency
}
```

### Required Parameters

| Parameter            | Type   | Description                                      | Example     |
| -------------------- | ------ | ------------------------------------------------ | ----------- |
| `EXCHANGE`           | string | Exchange name (must match CCXT)                  | `xt`        |
| `SYMBOL`             | string | Trading pair                                     | `ORBD/USDT` |
| `SIDE`               | string | Order side: `bid` or `ask`                       | `ask`       |
| `TOTAL_QUOTE_AMOUNT` | number | Total amount in quote currency (USD, USDT, etc.) | `5.5`       |
| `SPREAD_PERCENT`     | number | Spread range as percentage                       | `20`        |
| `NUMBER_OF_ORDERS`   | number | How many orders to distribute                    | `20`        |

### Optional Parameters

| Parameter                  | Type   | Default                  | Description                                              |
| -------------------------- | ------ | ------------------------ | -------------------------------------------------------- |
| `PRICE_REFERENCE`          | string | `mid`                    | Price reference: `first_ask`, `first_bid`, `mid`, `best` |
| `DRIFT_THRESHOLD_PERCENT`  | number | Same as `SPREAD_PERCENT` | Max drift % before refresh                               |
| `MONITOR_INTERVAL_SECONDS` | number | `1`                      | How often to check orders (seconds)                      |

### Price Reference Types

- **`mid`**: Average of best bid and ask (default, safest)
- **`first_ask`**: Lowest ask price (aggressive selling reference)
- **`first_bid`**: Highest bid price (aggressive buying reference)
- **`best`**: Auto-select based on side (bid uses `first_bid`, ask uses `first_ask`)

## 🚀 Usage

### Running BID Bot (Buying)

```bash
EXCHANGE=xt \
SYMBOL=ORBD/USDT \
SIDE=bid \
TOTAL_QUOTE_AMOUNT=5.5 \
SPREAD_PERCENT=20 \
NUMBER_OF_ORDERS=20 \
PRICE_REFERENCE=mid \
DRIFT_THRESHOLD_PERCENT=20 \
MONITOR_INTERVAL_SECONDS=1 \
npx tsx bots/crypto/cex/mm/mm-mono-side.ts
```

### Running ASK Bot (Selling)

```bash
EXCHANGE=xt \
SYMBOL=ORBD/USDT \
SIDE=ask \
TOTAL_QUOTE_AMOUNT=5.5 \
SPREAD_PERCENT=20 \
NUMBER_OF_ORDERS=20 \
PRICE_REFERENCE=mid \
DRIFT_THRESHOLD_PERCENT=20 \
MONITOR_INTERVAL_SECONDS=1 \
npx tsx bots/crypto/cex/mm/mm-mono-side.ts
```

### Minimal Example

```bash
# BID with minimal config (uses defaults)
EXCHANGE=xt SYMBOL=ORBD/USDT SIDE=bid TOTAL_QUOTE_AMOUNT=5 SPREAD_PERCENT=20 NUMBER_OF_ORDERS=10 npx tsx bots/crypto/cex/mm/mm-mono-side.ts

# ASK with minimal config
EXCHANGE=xt SYMBOL=ORBD/USDT SIDE=ask TOTAL_QUOTE_AMOUNT=5 SPREAD_PERCENT=20 NUMBER_OF_ORDERS=10 npx tsx bots/crypto/cex/mm/mm-mono-side.ts
```

### Quick Start Commands

Copy commands from [commands.txt](commands.txt):

```bash
# Terminal 1 - BID Bot
EXCHANGE=xt SYMBOL=ORBD/USDT SIDE=bid TOTAL_QUOTE_AMOUNT=5.5 SPREAD_PERCENT=20 NUMBER_OF_ORDERS=20 PRICE_REFERENCE=mid npx tsx mm/mm-mono-side.ts

# Terminal 2 - ASK Bot
EXCHANGE=xt SYMBOL=ORBD/USDT SIDE=ask TOTAL_QUOTE_AMOUNT=5.5 SPREAD_PERCENT=20 NUMBER_OF_ORDERS=20 PRICE_REFERENCE=mid npx tsx mm/mm-mono-side.ts
```

## 📈 Strategy Examples

### Conservative Strategy

```bash
SPREAD_PERCENT=30 NUMBER_OF_ORDERS=30 DRIFT_THRESHOLD_PERCENT=30
```

- Wide spread (30%)
- Many orders (30)
- Large drift tolerance (30%)
- Lower fill rate, but better prices

### Aggressive Strategy

```bash
SPREAD_PERCENT=5 NUMBER_OF_ORDERS=5 DRIFT_THRESHOLD_PERCENT=5
```

- Narrow spread (5%)
- Fewer orders (5)
- Tight drift tolerance (5%)
- Higher fill rate, tighter prices

### Balanced Strategy

```bash
SPREAD_PERCENT=20 NUMBER_OF_ORDERS=20 DRIFT_THRESHOLD_PERCENT=20
```

- Medium spread (20%)
- Medium order count (20)
- Balanced drift tolerance (20%)

## 🔍 Monitoring & Logs

### Startup Logs

```
🎯 Placing Mono-Side Orders for ORBD/USDT
   Side: ASK
   Total Amount: 5.5 (quote currency)
   Spread: 20%
   Number of Orders: 20

📍 Reference Price: 0.27500000

💰 Available ORBD: 25.00000000 (~$6.88 USDT)

🚀 Placing 20 orders in parallel...
```

### Order Placement

```
✅ Success 1: ID a1b2c3d4e5f6... (+2.5%)
✅ Success 2: ID f6e5d4c3b2a1... (+7.5%)
...
```

### Fill Detection

```
📦 2 order(s) filled!
📊 18 order(s) still open
   ASK side: 18 open

⚠️  Some ASK orders filled! Cancelling 18 remaining order(s)...
✅ Cancelled all remaining ASK orders

🔍 Checking if ASK side is clear...
✅ ASK side clear - placing new orders
```

### Drift Detection

```
📏 Drift threshold exceeded: 22.500% > 20.000%
   Closest order: 0.35000000 | Reference: 0.27500000
   Cancelling all ASK orders and replacing...
```

### Heartbeat (Stable State)

```
💓 [10:30:45 AM] Monitoring... 20/20 ask orders, drift: 5.234%
💓 [10:30:55 AM] Monitoring... 20/20 ask orders, drift: 5.891%
```

## 🛑 Stopping the Bot

Press `Ctrl+C` to gracefully shutdown:

```
^C
🛑 Shutting down...

📊 Current open orders: 20

🗑️  Cancelling all remaining orders...
✅ Bot stopped
```

## ⚠️ Important Notes

### Running Both Sides

- **Run BID and ASK in separate terminal windows/processes**
- Each bot manages its own side independently
- No coordination needed between bots - the smart refresh logic handles race conditions

### Balance Requirements

- **BID side**: Needs sufficient quote currency (USDT, USD, etc.)
- **ASK side**: Needs sufficient base currency (the token you're selling)
- Bot automatically adjusts if balance is insufficient

### Drift Threshold

- Default: Same as `SPREAD_PERCENT`
- Lower value = more frequent refreshes (more reactive)
- Higher value = fewer refreshes (more stable)

### Exchange Support

- Uses CCXT library - supports 100+ exchanges
- Ensure your exchange supports:
  - Limit orders
  - Fetching open orders
  - Batch order cancellation (or falls back to individual)

### API Keys

Configure your exchange API keys in the appropriate location (typically in `../account.ts` or `../exchange.ts` based on your setup).

## 🔧 Troubleshooting

### "Insufficient balance" error

- Check your account has enough funds
- For ASK: Need base currency (e.g., ORBD)
- For BID: Need quote currency (e.g., USDT)

### "Invalid precision" error

- Exchange rejected order due to decimal places
- Bot automatically handles this - if you see this, it's a bug

### Orders not being placed

- Check API keys are configured correctly
- Verify symbol format matches exchange (e.g., "ORBD/USDT" not "ORBDUSDT")
- Check exchange is operational

### "Order count mismatch" warnings

- Normal if you manually cancelled some orders
- Bot will automatically refresh to correct count

### Multiple refreshes in quick succession

- Reduce `DRIFT_THRESHOLD_PERCENT`
- Increase `MONITOR_INTERVAL_SECONDS`
- Market might be very volatile

## 📋 Function Reference

### Main Functions

| Function                       | Purpose                          |
| ------------------------------ | -------------------------------- |
| `placeMonoSideOrders()`        | Place all orders for one side    |
| `cancelMonoSideOrders()`       | Cancel orders with batch support |
| `startMonitoring()`            | Main monitoring loop             |
| `checkFilledOrders()`          | Detect filled orders             |
| `checkAndAdjustBalance()`      | Verify sufficient balance        |
| `getReferencePrice()`          | Get current market price         |
| `calculateOrderDistribution()` | Calculate order prices/amounts   |

### Helper Functions

| Function                 | Purpose                             |
| ------------------------ | ----------------------------------- |
| `prepareOrder()`         | Round and validate order parameters |
| `placeOrder()`           | Execute single limit order          |
| `checkOrderPriceDrift()` | Calculate drift from reference      |
| `handleOrderFills()`     | Handle fill events                  |
| `checkAccountBalance()`  | Display balance at startup          |
| `logOrderSummary()`      | Pretty-print order summary          |

## 🧪 Testing

### Test in Development

```bash
# Use small amounts for testing
TOTAL_QUOTE_AMOUNT=1 \
SPREAD_PERCENT=50 \
NUMBER_OF_ORDERS=5 \
MONITOR_INTERVAL_SECONDS=5 \
npx tsx bots/crypto/cex/mm/mm-mono-side.ts
```

### Monitor Performance

- Watch for fill rate
- Check spread efficiency
- Monitor drift triggers
- Review balance utilization

## 📜 License

Part of the algo-vista project.

## 🤝 Support

For issues or questions, refer to the main project documentation.

---

**⚡ Pro Tip**: Start with conservative settings (wide spread, high drift threshold) and gradually optimize based on observed performance and market conditions.
