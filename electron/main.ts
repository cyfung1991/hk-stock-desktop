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

interface EtnetQuote {
  name: string
  currentPrice: string
  change: string        // absolute change, e.g. "+4.30" — used to derive previousClose
  todayTop: string
  todayBottom: string
  previousClose: string
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

type Source = 'auto' | 'etnet' | 'yahoo'

const formatNumber = (value: unknown, decimals = 3): string => {
  const num = Number(String(value).replace(/,/g, ''))
  return Number.isFinite(num) ? num.toFixed(decimals) : '-'
}

const average = (values: number[], days: number): number | null => {
  const sliced = values.slice(-days).filter(Number.isFinite)
  if (!sliced.length) return null

  return sliced.reduce((sum, value) => sum + value, 0) / sliced.length
}

// Uses a hidden BrowserWindow so the page's own JavaScript executes and
// populates the real-time price fields before we read them.
const getEtnetQuote = (stockCode: string): Promise<EtnetQuote> => {
  const code = stockCode.padStart(4, '0')

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        javascript: true,
        nodeIntegration: false,
        contextIsolation: true,
      }
    })

    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      try { win.destroy() } catch { /* already destroyed */ }
      fn()
    }

    const timer = setTimeout(
      () => settle(() => reject(new Error('ETNet timeout'))),
      20000
    )

    win.webContents.setUserAgent(BROWSER_UA)
    win.loadURL(
      `https://www.etnet.com.hk/www/chi/stocks/realtime/quote.php?code=${code}`
    )

    win.webContents.on('did-finish-load', () => {
      // Allow 3 s for the page's JS to fill in real-time price spans
      setTimeout(async () => {
        clearTimeout(timer)
        try {
          const data: EtnetQuote = await win.webContents.executeJavaScript(`
            (() => {
              const trim = s => (s || '').replace(/[\\u00a0\\s]+/g, ' ').trim()
              const val = sel => { const el = document.querySelector(sel); return el ? trim(el.textContent) : '' }

              // Stock name — try common selectors then fall back to page title
              const nameSels = [
                '.stockNameChinese', '#stockNameChinese',
                '.stockName', '.stock-name', 'h1.name',
                '.title-name', '.stockname'
              ]
              let name = nameSels.reduce((acc, sel) => acc || val(sel), '')
              if (!name) {
                const m = document.title.match(/^(.+?)[\\s(（]\\d/)
                name = m ? m[1].trim() : document.title.split('|')[0].split('-')[0].trim()
              }

              // Current price and today's change live side-by-side in the main box
              const currentPrice =
                val('#StkDetailMainBox .styleA .Price') ||
                val('.quote-price .Price') ||
                val('span.Price')

              // Absolute change, e.g. "+4.30" or "-1.20" — strip any percent clause
              const changeRaw =
                val('#StkDetailMainBox .styleA .Change') ||
                val('.quote-price .Change') ||
                val('span.Change')
              const changeMatch = changeRaw.match(/([+-]?[\d,]+\.?\d*)/)
              const change = changeMatch ? changeMatch[1].replace(/,/g, '') : ''

              // Helper: search all .styleB cells for a label and return its number span
              const cells = [...document.querySelectorAll('#StkDetailMainBox td.styleB')]
              const pick = (...labels) => {
                for (const label of labels) {
                  const cell = cells.find(c => c.textContent.includes(label))
                  if (!cell) continue
                  const num = cell.querySelector('span.RT, span.Number, span.Nominal')
                  if (num) return trim(num.textContent)
                }
                return ''
              }

              return {
                name,
                currentPrice,
                change,
                todayTop:      pick('最高', 'High'),
                todayBottom:   pick('最低', 'Low'),
                previousClose: pick('昨收', '昨日收市', 'Prev Close', 'Previous Close'),
              }
            })()
          `)
          settle(() => resolve(data))
        } catch (e) {
          settle(() => reject(e))
        }
      }, 3000)
    })

    win.webContents.on('did-fail-load', (_e, _code, desc) => {
      clearTimeout(timer)
      settle(() => reject(new Error(`ETNet load failed: ${desc}`)))
    })
  })
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

const getStock = async (stockCode: string, source: Source = 'auto'): Promise<StockData> => {
  if (source === 'yahoo') return getYahooStock(stockCode)

  if (source === 'etnet') {
    const etnet = await getEtnetQuote(stockCode)
    if (!etnet.currentPrice) throw new Error('ETNet returned no price')
    const code = stockCode.padStart(4, '0')
    const etnetPreviousClose = (() => {
      if (etnet.previousClose) return etnet.previousClose
      const price = Number(etnet.currentPrice)
      const chg   = Number(etnet.change)
      if (Number.isFinite(price) && Number.isFinite(chg) && chg !== 0) return formatNumber(price - chg)
      return ''
    })()
    return {
      source: 'ETNet',
      name: etnet.name || code,
      number: code,
      currentPrice: etnet.currentPrice,
      todayTop: etnet.todayTop || '-',
      todayBottom: etnet.todayBottom || '-',
      previousClose: etnetPreviousClose || '-',
      avg10: '-', avg20: '-', avg50: '-', avg100: '-', avg250: '-',
      week52Top: '-', week52Bottom: '-',
      history: []
    }
  }

  // 'auto' — fetch both concurrently; ETNet for real-time quote,
  // Yahoo for 1-year history, moving averages, and 52-week range.
  const [etnetResult, yahooResult] = await Promise.allSettled([
    getEtnetQuote(stockCode),
    getYahooStock(stockCode)
  ])

  if (etnetResult.status === 'rejected' && yahooResult.status === 'rejected') {
    throw yahooResult.reason
  }

  // etnet failed or returned no price → fall back to Yahoo only
  if (etnetResult.status === 'rejected' || !etnetResult.value.currentPrice) {
    if (yahooResult.status === 'rejected') throw yahooResult.reason

    return yahooResult.value
  }

  const etnet = etnetResult.value

  // Prefer the directly-scraped "昨收" label; fall back to deriving from
  // the change value only if the label couldn't be scraped.
  const etnetPreviousClose = (() => {
    if (etnet.previousClose) return etnet.previousClose
    const price = Number(etnet.currentPrice)
    const chg   = Number(etnet.change)
    if (Number.isFinite(price) && Number.isFinite(chg) && chg !== 0) {
      return formatNumber(price - chg)
    }
    return ''
  })()

  // Yahoo failed → return etnet data alone (no chart or averages)
  if (yahooResult.status === 'rejected') {
    const code = stockCode.padStart(4, '0')

    return {
      source: 'ETNet',
      name: etnet.name || code,
      number: code,
      currentPrice: etnet.currentPrice,
      todayTop: etnet.todayTop || '-',
      todayBottom: etnet.todayBottom || '-',
      previousClose: etnetPreviousClose || '-',
      avg10: '-', avg20: '-', avg50: '-', avg100: '-', avg250: '-',
      week52Top: '-', week52Bottom: '-',
      history: []
    }
  }

  const yahoo = yahooResult.value

  // Merge: etnet supplies real-time quote; Yahoo supplies history & derived data
  return {
    source: 'ETNet + Yahoo averages',
    name: etnet.name || yahoo.name,
    number: stockCode.padStart(4, '0'),
    currentPrice: etnet.currentPrice,
    todayTop: etnet.todayTop || yahoo.todayTop,
    todayBottom: etnet.todayBottom || yahoo.todayBottom,
    previousClose: etnetPreviousClose || yahoo.previousClose,
    avg10: yahoo.avg10,
    avg20: yahoo.avg20,
    avg50: yahoo.avg50,
    avg100: yahoo.avg100,
    avg250: yahoo.avg250,
    week52Top: yahoo.week52Top,
    week52Bottom: yahoo.week52Bottom,
    history: yahoo.history
  }
}

const createWindow = (): void => {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs')
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.disableHardwareAcceleration()

app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')

app.whenReady().then(() => {
  // Strip "Electron/x.y.z" from the default UA so scraped sites see a plain browser
  app.userAgentFallback = BROWSER_UA

  ipcMain.handle('get-stock', async (_event, stockCode: string, source: Source = 'auto') => {
    return getStock(stockCode, source)
  })

  createWindow()
})
