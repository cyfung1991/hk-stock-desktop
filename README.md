# HK Stock Desktop

A desktop app for looking up Hong Kong stock quotes. Built with Electron, React, TypeScript, and Vite.

## Features

- Real-time price, day high/low, and previous close from Eastmoney (東方財富)
- 1-year daily close price chart with interactive crosshair
- 52-week range and today range position charts
- 10/20/50/100/250-day moving averages with bar chart
- Favourites list (up to 10) with auto-refresh every 60 seconds
- Recent search history (up to 20 entries)
- Bilingual UI (Traditional Chinese / English)

## Data Sources

All quotes come from the **Eastmoney (東方財富) JSON API** — a plain HTTP call, no hidden browser required.  
Moving averages, 52-week range, and price history are fetched from the **Yahoo Finance chart API**.

| Field | Source |
|-------|--------|
| Current price, day high/low, prev close | Eastmoney `push2delay.eastmoney.com` |
| 1-year daily history, moving averages, 52-week range | Yahoo Finance v8 chart API |

If Eastmoney is unreachable, the app falls back to Google Finance, then Yahoo Finance.

## Tech Stack

- **Electron** — desktop shell, IPC for stock fetching
- **React 18** + **TypeScript** — UI
- **Vite** + `vite-plugin-electron` — bundler
- **axios** — HTTP requests
- **electron-builder** — packaging (portable `.exe`)

## Getting Started

```bash
npm install
npm run dev
```

This starts the Vite dev server and opens the Electron window.

## Build

Run from **Windows PowerShell** (not WSL — electron-builder targets the host OS):

```powershell
npm run build
```

Output: `release\0.0.0\HK Stock Desktop.exe` (portable, no installer needed).

## Project Structure

```
electron/
  main.ts       — Main process: Eastmoney + Yahoo Finance fetching via IPC
  preload.ts    — Context bridge: exposes window.stockAPI to the renderer
src/
  App.tsx       — React UI (search, charts, sidebar, i18n)
  App.css       — All styles
  i18n.ts       — Translation strings (zh / en) and React context
  stock.interface.ts — Shared StockData / PricePoint types
```

## Stock Code Format

Enter a numeric HKEX stock code (e.g. `5` for HSBC, `700` for Tencent, `9988` for Alibaba).  
Codes are zero-padded to 4 digits for Yahoo (`0005.HK`) and 5 digits for Eastmoney (`116.00005`).
