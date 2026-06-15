export interface StockData {
  source: string
  name: string
  number: string
  currentPrice: string
  todayTop: string
  todayBottom: string
  avg10: string
  avg20: string
  avg50: string
  avg100: string
  avg250: string
  week52Top: string
  week52Bottom: string
  previousClose?: string
  history: PricePoint[]
}

export interface PricePoint {
  date: string
  close: number
}
