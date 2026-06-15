/// <reference types="vite/client" />

import type { StockData } from './stock.interface'

declare global {
  interface Window {
    stockAPI?: {
      getStock: (stockCode: string, source?: 'auto' | 'etnet' | 'yahoo') => Promise<StockData>
    }
  }
}

export {}
