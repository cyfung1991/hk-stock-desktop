import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import axios from 'axios'

interface StockData {
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
  previousClose: string
  history: PricePoint[]
}

interface PricePoint {
  date: string
  close: number
}


const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// A real-browser User-Agent so ETNet and Yahoo don't see Electron's default UA
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

// Request headers that mimic a browser fetching from Yahoo Finance
const YAHOO_HEADERS = {
  'User-Agent': BROWSER_UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
}


type Source = 'auto' | 'etnet' | 'yahoo' | 'hkex' | 'eastmoney'

const formatNumber = (value: unknown, decimals = 3): string => {
  const num = Number(String(value).replace(/,/g, ''))
  return Number.isFinite(num) ? num.toFixed(decimals) : '-'
}

const average = (values: number[], days: number): number | null => {
  const sliced = values.slice(-days).filter(Number.isFinite)
  if (!sliced.length) return null

  return sliced.reduce((sum, value) => sum + value, 0) / sliced.length
}

// ─── Google Finance scraper ──────────────────────────────────────────────────
// Google Finance server-renders the current price in the initial HTML response,
// so a plain axios GET is sufficient — no hidden browser or JavaScript needed.

interface GoogleQuote {
  name: string
  price: string
  high: string
  low: string
  prevClose: string
  hi52: string
  lo52: string
}

const getGoogleFinanceQuote = async (stockCode: string): Promise<GoogleQuote> => {
  const code = stockCode.padStart(4, '0')
  const url = `https://www.google.com/finance/quote/${code}:HKG`

  const { data: html } = await axios.get<string>(url, {
    timeout: 8000,
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  })

  const clean = (s: string) => s.replace(/[$,\s]/g, '')
  const pick  = (re: RegExp) => { const m = html.match(re); return m ? clean(m[1]) : '' }

  // Name from <title>: "HSBC Holdings plc (0005) Stock Price..."
  const name = (html.match(/<title>([^(<]+)/) ?? [])[1]?.trim() ?? code

  // Current price — try several patterns Google has used
  const price =
    pick(/data-last-price="([0-9,.]+)"/) ||
    pick(/class="YMlKec[^"]*">\$?([0-9,.]+)<\/div>/) ||
    pick(/([0-9,]+\.[0-9]{2,3})[^0-9.]{1,60}HKD/) ||
    pick(/([0-9,]+\.[0-9]{2,3})[^0-9.]{1,60}HKG/)

  if (!price) throw new Error(`Google Finance: price not found for ${code} (${url})`)

  // "Previous close\n142.80"
  const prevClose = pick(/Previous close[^0-9]*([0-9,.]+)/)

  // "Day range\n143.40 – 145.50"
  const dayM = html.match(/Day range[^0-9]*([0-9,.]+)[^0-9,.]+([0-9,.]+)/)
  const low  = dayM ? clean(dayM[1]) : '-'
  const high = dayM ? clean(dayM[2]) : '-'

  // "Year range\n91.00 – 148.80"
  const yrM  = html.match(/Year range[^0-9]*([0-9,.]+)[^0-9,.]+([0-9,.]+)/)
  const lo52 = yrM ? clean(yrM[1]) : '-'
  const hi52 = yrM ? clean(yrM[2]) : '-'

  return { name, price, high, low, prevClose, hi52, lo52 }
}

// ─── Shared Yahoo chart helper (history + moving averages only) ───────────────
interface YahooChart {
  closes: number[]
  history: PricePoint[]
  week52Top: number
  week52Bottom: number
  previousClose: number | null
}

const getYahooChart = async (stockCode: string): Promise<YahooChart> => {
  const symbol = `${stockCode.padStart(4, '0')}.HK`
  const [r1y, r5d] = await Promise.all([
    axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`, { timeout: 8000, headers: YAHOO_HEADERS }),
    axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=1d`, { timeout: 8000, headers: YAHOO_HEADERS }),
  ])
  const result = r1y.data.chart.result?.[0]
  if (!result) throw new Error('Yahoo chart data not found')
  const q   = result.indicators.quote[0]
  const ts: number[] = result.timestamp ?? []
  const history = ts
    .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: q.close[i] }))
    .filter((p): p is PricePoint => Number.isFinite(p.close))
  const closes5d = ((r5d.data.chart.result?.[0]?.indicators?.quote?.[0]?.close ?? []) as number[]).filter(Number.isFinite)
  return {
    closes: history.map(p => p.close),
    history,
    week52Top:    Math.max(...q.high.filter(Number.isFinite)),
    week52Bottom: Math.min(...q.low.filter(Number.isFinite)),
    previousClose: closes5d.length >= 2 ? closes5d[closes5d.length - 2] : null,
  }
}

const getGoogleFinanceStock = async (stockCode: string, sourceName: string): Promise<StockData> => {
  const code = stockCode.padStart(4, '0')
  const [gfResult, chartResult] = await Promise.allSettled([
    getGoogleFinanceQuote(stockCode),
    getYahooChart(stockCode),
  ])

  if (gfResult.status === 'rejected') throw gfResult.reason

  const gf     = gfResult.value
  const chart  = chartResult.status === 'fulfilled' ? chartResult.value : null
  const closes = chart?.closes ?? []

  const prevClose = chart?.previousClose !== null && chart?.previousClose !== undefined
    ? formatNumber(chart.previousClose)
    : gf.prevClose || '-'

  return {
    source: sourceName,
    name: gf.name || code,
    number: code,
    currentPrice: formatNumber(gf.price),
    todayTop:     gf.high !== '-' ? formatNumber(gf.high) : '-',
    todayBottom:  gf.low  !== '-' ? formatNumber(gf.low)  : '-',
    previousClose: prevClose,
    avg10:  formatNumber(average(closes, 10)),
    avg20:  formatNumber(average(closes, 20)),
    avg50:  formatNumber(average(closes, 50)),
    avg100: formatNumber(average(closes, 100)),
    avg250: formatNumber(average(closes, 250)),
    week52Top:    chart ? formatNumber(chart.week52Top)    : (gf.hi52 !== '-' ? formatNumber(gf.hi52) : '-'),
    week52Bottom: chart ? formatNumber(chart.week52Bottom) : (gf.lo52 !== '-' ? formatNumber(gf.lo52) : '-'),
    history: chart?.history ?? [],
  }
}

const getYahooStock = async (stockCode: string): Promise<StockData> => {
  const code = stockCode.padStart(4, '0')
  const symbol = `${code}.HK`

  // Fetch 1y (adjusted) for averages/history and 5d (unadjusted) for previous close concurrently.
  // The 1y range uses dividend-adjusted prices — good for moving averages but wrong for
  // the previous-close comparison. The 5d range returns raw unadjusted prices.
  const [response, response5d] = await Promise.all([
    axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`, { timeout: 8000, headers: YAHOO_HEADERS }),
    axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=1d`, { timeout: 8000, headers: YAHOO_HEADERS }),
  ])

  const result = response.data.chart.result?.[0]

  if (!result) {
    throw new Error('Yahoo stock data not found')
  }

  const meta = result.meta
  const quote = result.indicators.quote[0]
  const timestamps: number[] = result.timestamp ?? []

  const history = timestamps
    .map((timestamp, index) => {
      const close = quote.close[index]

      return {
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        close: typeof close === 'number' ? close : Number.NaN
      }
    })
    .filter((point): point is PricePoint => Number.isFinite(point.close))

  const closes = history.map((p) => p.close)
  const highs = quote.high.filter(Number.isFinite)
  const lows = quote.low.filter(Number.isFinite)

  // Derive previous close from 5d unadjusted data:
  // last entry = most recent traded day, second-to-last = previous day's close.
  const closes5d = ((response5d.data.chart.result?.[0]?.indicators?.quote?.[0]?.close ?? []) as number[])
    .filter(Number.isFinite)
  const previousClose = closes5d.length >= 2 ? closes5d[closes5d.length - 2] : null

  return {
    source: '雅虎財經',
    name: meta.longName ?? meta.shortName ?? symbol,
    number: code,
    currentPrice: formatNumber(meta.regularMarketPrice),
    todayTop: formatNumber(meta.regularMarketDayHigh),
    todayBottom: formatNumber(meta.regularMarketDayLow),
    avg10: formatNumber(average(closes, 10)),
    avg20: formatNumber(average(closes, 20)),
    avg50: formatNumber(average(closes, 50)),
    avg100: formatNumber(average(closes, 100)),
    avg250: formatNumber(average(closes, 250)),
    week52Top: formatNumber(Math.max(...highs)),
    week52Bottom: formatNumber(Math.min(...lows)),
    previousClose: formatNumber(previousClose),
    history
  }
}

// ─── Eastmoney (東方財富) scraper ─────────────────────────────────────────────
// push2.eastmoney.com is a plain JSON API — no browser needed.
// HK stocks use secid prefix 116 with a 5-digit zero-padded code.
// Field map: f43=price, f44=high, f45=low, f58=name, f60=prevClose, f169=change, f170=change%
const getEastmoneyStock = async (stockCode: string): Promise<StockData> => {
  const code  = stockCode.padStart(4, '0')
  const secid = `116.${stockCode.padStart(5, '0')}`

  // push2.eastmoney.com is an nginx proxy that sometimes returns 502.
  // Try multiple known endpoints in order until one succeeds.
  const EASTMONEY_HOSTS = [
    'push2delay.eastmoney.com',
    'push2.eastmoney.com',
    'push2ct.eastmoney.com',
  ]
  const emParams = { invt: 2, fltt: 2, fields: 'f43,f44,f45,f57,f58,f60,f169,f170', secid }
  const emHeaders = { 'User-Agent': BROWSER_UA, 'Referer': 'https://quote.eastmoney.com/', 'Accept': 'application/json, text/plain, */*' }

  let quoteData: Record<string, unknown> | null = null
  for (const host of EASTMONEY_HOSTS) {
    try {
      const res = await axios.get(`https://${host}/api/qt/stock/get`, { timeout: 8000, params: emParams, headers: emHeaders })
      const d = res.data?.data
      if (d?.f43 !== undefined && d?.f43 !== null && d?.f43 !== '-' && d?.f43 !== 0) {
        quoteData = d
        break
      }
    } catch { /* try next host */ }
  }

  const [quoteRes, chartRes] = await Promise.allSettled([
    quoteData ? Promise.resolve(quoteData) : Promise.reject(new Error('All Eastmoney hosts failed')),
    getYahooChart(stockCode),
  ])

  if (quoteRes.status === 'rejected') throw quoteRes.reason

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = quoteRes.value as any
  console.log(`[Eastmoney] ${secid} →`, JSON.stringify(d))

  const chart  = chartRes.status === 'fulfilled' ? chartRes.value : null
  const closes = chart?.closes ?? []

  return {
    source: '東方財富',
    name:  d.f58 || code,
    number: code,
    currentPrice:  formatNumber(d.f43),
    todayTop:      formatNumber(d.f44),
    todayBottom:   formatNumber(d.f45),
    previousClose: chart?.previousClose != null ? formatNumber(chart.previousClose) : formatNumber(d.f60),
    avg10:  formatNumber(average(closes, 10)),
    avg20:  formatNumber(average(closes, 20)),
    avg50:  formatNumber(average(closes, 50)),
    avg100: formatNumber(average(closes, 100)),
    avg250: formatNumber(average(closes, 250)),
    week52Top:    chart ? formatNumber(chart.week52Top)    : '-',
    week52Bottom: chart ? formatNumber(chart.week52Bottom) : '-',
    history: chart?.history ?? [],
  }
}

const tryAll = async (...fns: (() => Promise<StockData>)[]): Promise<StockData> => {
  let lastErr: unknown
  for (const fn of fns) {
    try { return await fn() } catch (e) { lastErr = e }
  }
  throw lastErr
}

const getStock = async (stockCode: string, source: Source = 'auto'): Promise<StockData> => {
  if (source === 'yahoo')     return getYahooStock(stockCode)
  if (source === 'eastmoney') return getEastmoneyStock(stockCode)
  // etnet / hkex / auto: try Eastmoney first (stable JSON API), fall back to Google Finance, then Yahoo
  const label = source === 'etnet' ? 'ETNet' : source === 'hkex' ? 'HKEX' : 'Google Finance'
  return tryAll(
    () => getEastmoneyStock(stockCode),
    () => getGoogleFinanceStock(stockCode, label),
    () => getYahooStock(stockCode),
  )
}

const createWindow = (): void => {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    show: false,
    backgroundColor: '#eef2f6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs')
    }
  })

  win.once('ready-to-show', () => win.show())

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  // Strip "Electron/x.y.z" from the default UA so scraped sites see a plain browser
  app.userAgentFallback = BROWSER_UA

  ipcMain.handle('get-stock', async (_event, stockCode: string, source: Source = 'auto') => {
    return getStock(stockCode, source)
  })

  createWindow()
})
