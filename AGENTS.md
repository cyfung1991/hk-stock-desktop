# HK Stock Desktop — Agent Guide

## Project Overview

Electron desktop app for looking up Hong Kong stock quotes. Enter a stock code (e.g. `5`, `700`, `9988`) and it shows current price, today's high/low, 52-week range, moving averages (10/20/50/100/250-day), and a 1-year price chart.

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 30 (Node.js 20) |
| UI framework | React 18 + TypeScript |
| Bundler | Vite + vite-plugin-electron |
| Packaging | electron-builder (portable `.exe`) |
| Data source | Yahoo Finance v8 JSON API |
| HTTP client | axios |

## Architecture

```
electron/
  main.ts       — Electron main process; fetches stock data via Yahoo Finance API
  preload.ts    — Exposes window.stockAPI.getStock() to the renderer via contextBridge
src/
  App.tsx       — Full React UI: search bar, metric tiles, price chart, range chart, averages
  App.css       — All styles
  index.css     — Root font stack (includes CJK fallbacks: Microsoft YaHei, PingFang TC)
  stock.interface.ts  — Shared StockData + PricePoint TypeScript interfaces
  main.tsx      — React entry point
```

## Data Flow

1. User types a stock code and submits.
2. Renderer calls `window.stockAPI.getStock(code)` (defined in `preload.ts`).
3. Main process receives the IPC call and hits the Yahoo Finance v8 chart API:
   ```
   https://query1.finance.yahoo.com/v8/finance/chart/0005.HK?range=1y&interval=1d
   ```
4. Returns `StockData` — all price fields are pre-formatted strings (2 decimal places).
5. Moving averages are computed in-process from the 1-year daily close history.

## Key Behaviours / Gotchas

- **Stock code padding**: input `5` → padded to `0005` → Yahoo symbol `0005.HK`.
- **Previous close**: preferred from `meta.regularMarketPreviousClose`, falls back to `meta.chartPreviousClose`, then second-last historical close.
- **GPU disabled**: `app.disableHardwareAcceleration()` + `disable-gpu` + `disable-software-rasterizer` are set in `main.ts` to work around rendering issues on some Windows machines. Do not remove without testing.
- **ETNet scraping was removed**: ETNet's quote page loads prices via JavaScript; static HTML scraping via cheerio picked up prices from other stocks on the sidebar, producing wildly wrong values. All data now comes from Yahoo Finance.
- **undici pinned to v6**: `undici` v7+ imports `node:sqlite` which does not exist in Electron 30's Node.js 20. The `overrides` field in `package.json` pins it to `^6`.

## Development Environment

- **OS**: Windows 11
- **Shell for development**: WSL2 (Ubuntu or similar)
- **Shell for building**: Windows PowerShell (mandatory — see below)

### Running the dev server (WSL is fine)

```bash
npm install
npm run dev
```

Vite starts the renderer dev server and Electron loads it via `VITE_DEV_SERVER_URL`. Hot reload works normally.

### Building the portable `.exe` (must be Windows PowerShell)

electron-builder targets the host OS. Running `npm run build` inside WSL produces a Linux `.AppImage`, not a Windows `.exe`.

**Requirement**: Node.js must be installed on Windows (not just in WSL).
Install via winget if not already done:
```powershell
winget install OpenJS.NodeJS.LTS
```

Then open PowerShell, navigate to the project, and build:
```powershell
cd D:\Project\hk-stock-desktop
npm install   # only needed first time or after dependency changes
npm run build
```

Or double-click **`build.bat`** in the project root — it does the same thing.

Output: `release\0.0.0\YourAppName.exe` (portable, no installer needed).

### Why build fails when run from WSL

- WSL is a Linux environment; electron-builder picks `linux` as the target platform.
- Cross-compiling to Windows from Linux requires Wine, which is unreliable and not set up here.
- The fix is to always run `npm run build` from a native Windows shell.

## Build Output

After `npm run build` (run from Windows PowerShell):

```
release/
  0.0.0/
    YourAppName.exe     ← portable executable, ready to run
```

Intermediate folders (`dist/`, `dist-electron/`, `release/*/win-unpacked/`) are automatically cleaned up by the `postbuild` script.

## Package Scripts

| Script | Where to run | Purpose |
|---|---|---|
| `npm run dev` | WSL or Windows | Start dev server with hot reload |
| `npm run build` | **Windows PowerShell only** | Compile + package → portable `.exe` |
| `npm run lint` | Either | ESLint check |

## Styling Notes

- All UI text is Traditional Chinese.
- Font stack in `index.css` includes `Microsoft YaHei` and `PingFang TC` to ensure CJK characters render correctly. Do not remove these fallbacks.
- Trend colours: red = up (Hong Kong convention), green = down, blue = neutral.
