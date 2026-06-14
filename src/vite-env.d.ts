/// <reference types="vite/client" />

import type { StockData } from './stock.interface'

declare global {
  interface Window {
    stockAPI?: {
      getStock: (stockCode: string) => Promise<StockData>
    }
  }
}

export {}
