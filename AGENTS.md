# HK Stock Desktop — Agent Guide

## Project Overview

Electron desktop app for looking up Hong Kong stock quotes. Enter a stock code (e.g. `5`, `700`, `9988`) and it shows current price, today's high/low, previous close, 52-week range, moving averages (10/20/50/100/250-day), and a 1-year price chart.

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 30 (Node.js 20) |
| UI framework | React 18 + TypeScript |
| Bundler | Vite + vite-plugin-electron |
| Packaging | electron-builder (portable `.exe`) |
| Primary data source | Eastmoney (東方財富) JSON API |
| Secondary data source | Yahoo Finance v8 chart API |
| HTTP client | axios |

## Architecture

```
electron/
  main.ts       — Main process: stock fetching (Eastmoney quote + Yahoo chart), IPC handler
  preload.ts    — Exposes window.stockAPI.getStock() to renderer via contextBridge
src/
  App.tsx       — Full React UI: search, metric tiles, price chart, range charts, averages, sidebar
  App.css       — All styles
  i18n.ts       — Translation strings (zh / en) and React context
  stock.interface.ts  — Shared StockData + PricePoint TypeScript interfaces
  main.tsx      — React entry point
```

## Data Flow

1. User types a stock code and presses Enter.
2. Renderer calls `window.stockAPI.getStock(code, 'eastmoney')` (defined in `preload.ts`).
3. Main process runs `getEastmoneyStock` + `getYahooChart` concurrently:
   - **Eastmoney** (`push2delay.eastmoney.com/api/qt/stock/get?secid=116.00005`): returns real-time price, day high/low, previous close, stock name in Chinese.
   - **Yahoo chart** (`query1.finance.yahoo.com/v8/finance/chart/0005.HK?range=1y&interval=1d`): returns 1-year daily closes for moving averages, 52-week range, and the price history chart.
4. Returns `StockData` — all price fields are pre-formatted strings (3 decimal places via `formatNumber`).

## Key Functions (electron/main.ts)

| Function | Purpose |
|---|---|
| `getEastmoneyStock(code)` | Tries `push2delay`, `push2`, `push2ct` eastmoney hosts in order; pairs with `getYahooChart` |
| `getYahooChart(code)` | Fetches 1y + 5d chart data; returns closes, history, 52-week range, previous close |
| `getGoogleFinanceStock(code, label)` | Fallback: scrapes Google Finance HTML for real-time quote |
| `getYahooStock(code)` | Fallback of last resort: Yahoo Finance for all fields |
| `getStock(code, source)` | IPC entry point; routes by source, `eastmoney` is default |
| `tryAll(...fns)` | Tries each async function in order, returns first success |
| `formatNumber(value, decimals)` | Formats a numeric value to a fixed-decimal string, returns `'-'` on invalid input |
| `average(closes, days)` | Computes simple moving average from a closes array |

## Eastmoney API Field Map

`secid` format: `116.XXXXX` where `XXXXX` is the 5-digit zero-padded HK stock code.

| Field | Meaning |
|---|---|
| `f43` | Current price |
| `f44` | Day high |
| `f45` | Day low |
| `f57` | Stock code |
| `f58` | Stock name (Simplified Chinese) |
| `f60` | Previous close |
| `f169` | Absolute price change |
| `f170` | Percentage change |

## Fallback Chain

For the `eastmoney` source (the only active source):
1. Try Eastmoney (`push2delay` → `push2` → `push2ct`)
2. Fall back to Google Finance HTML scrape
3. Fall back to Yahoo Finance API

## Key Behaviours / Gotchas

- **Stock code padding**: input `5` → `0005` for Yahoo/Google, `00005` for Eastmoney secid.
- **No hidden BrowserWindow**: ETNet and HKEX scrapers using Electron's BrowserWindow + CDP were removed. All fetching is plain axios HTTP calls.
- **Source selection removed from UI**: The source toggle buttons were removed. The app always uses Eastmoney with the fallback chain above.
- **Eastmoney 502**: `push2.eastmoney.com` has an nginx proxy that intermittently returns 502. The code iterates `EASTMONEY_HOSTS` to find a live server.
- **Yahoo chart uses `Promise.all`**: If either the 1y or 5d request fails, the whole chart call rejects. This is caught by `Promise.allSettled` in the caller — averages and history will show `'-'` but the quote still loads.
- **Safety timeout in renderer**: `fetchStock` in `App.tsx` races the IPC call against a 30-second timer to ensure `loading` is always cleared even if the main process hangs.
- **GPU disabled**: `app.disableHardwareAcceleration()` is set in `main.ts` for Windows compatibility. Do not remove.
- **undici pinned to v6**: `undici` v7+ imports `node:sqlite` which does not exist in Electron 30's Node.js 20. The `overrides` field in `package.json` pins it to `^6`.

## Development Environment

- **OS**: Windows 11
- **Shell for development**: WSL2 or Windows PowerShell
- **Shell for building**: Windows PowerShell only (see below)

### Running the dev server

```bash
npm install
npm run dev
```

Vite starts the renderer dev server and Electron loads it. Hot reload works for the renderer; **restart Electron** after changes to `electron/main.ts`.

### Building the portable `.exe` (must be Windows PowerShell)

electron-builder targets the host OS. Running `npm run build` inside WSL produces a Linux `.AppImage`.

```powershell
cd D:\Project\hk-stock-desktop
npm run build
```

Output: `release\0.0.0\HK Stock Desktop.exe` (portable, no installer).

## Styling Notes

- Trend colours follow Hong Kong convention: **red = price up**, **green = price down**, blue = neutral.
- Font stack includes `Microsoft YaHei` and `PingFang TC` for CJK characters. Do not remove.
- All layout is in `App.css`; no CSS modules or Tailwind.
