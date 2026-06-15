import { type CSSProperties, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import type { PricePoint, StockData } from './stock.interface'
import { type Lang, LangContext, translations, useT } from './i18n'

type Source = 'auto' | 'etnet' | 'yahoo'

interface MetricTileProps {
  label: string
  subValue?: string
  trend?: Trend
  value: string
  tone?: 'primary' | 'high' | 'low' | 'neutral' | 'up' | 'down'
}

interface RangeChartProps {
  current: number | null
  high: number | null
  highLabel: string
  label: string
  low: number | null
  lowLabel: string
}

interface AveragePoint {
  label: string
  value: number | null
  display: string
}

interface SidebarEntry {
  number: string
  name: string
  price: string
  change: number | null
  changePercent: number | null
  trend: Trend
}

interface SidebarItemProps {
  entry: SidebarEntry
  isActive: boolean
  isFav: boolean
  onSelect: () => void
  onToggleFav: () => void
}

interface PriceChartProps {
  current: number | null
  history: PricePoint[]
  previousClose: number | null
}

type Trend = 'up' | 'down' | 'flat'

const toNumber = (value: string): number | null => {
  const numeric = Number(value.replace(/,/g, ''))
  return Number.isFinite(numeric) ? numeric : null
}

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max)
}

const getPercent = (value: number | null, low: number | null, high: number | null): number => {
  if (value === null || low === null || high === null || high <= low) return 50

  return clamp(((value - low) / (high - low)) * 100, 0, 100)
}

const getBarWidth = (value: number | null, min: number, max: number): number => {
  if (value === null || max <= min) return 0

  return clamp(((value - min) / (max - min)) * 100, 8, 100)
}

const getTrend = (value: number | null): Trend => {
  if (value === null || value === 0) return 'flat'

  return value > 0 ? 'up' : 'down'
}

const formatSigned = (value: number | null, suffix = ''): string => {
  if (value === null) return '-'

  return `${value > 0 ? '+' : ''}${value.toFixed(2)}${suffix}`
}

const formatMovement = (change: number | null, percent: number | null): string => {
  if (change === null || percent === null) return '-'

  return `${formatSigned(change)} (${formatSigned(percent, '%')})`
}

const stockToSidebarEntry = (data: StockData): SidebarEntry => {
  const current = toNumber(data.currentPrice)
  const history = data.history ?? []
  const fallbackPrev = history.length > 0 ? history[history.length - 1].close : null
  const prev = toNumber(data.previousClose ?? '') ?? fallbackPrev
  const change = current !== null && prev !== null ? current - prev : null
  const changePercent = change !== null && prev ? (change / prev) * 100 : null
  return {
    number: data.number,
    name: data.name,
    price: data.currentPrice,
    change,
    changePercent,
    trend: getTrend(change),
  }
}

const formatSource = (source: string): string => {
  if (source === '雅虎財經') return source
  if (source === 'ETNet + Yahoo averages') return 'ETNet + 雅虎均線'
  if (source === 'ETNet') return 'ETNet'

  return source
}

const vars = (styles: Record<string, string>): CSSProperties => {
  return styles as CSSProperties
}

function MetricTile({ label, subValue, trend = 'flat', value, tone = 'neutral' }: MetricTileProps) {
  return (
    <article className={`metric-tile metric-tile-${tone}`}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {subValue && <span className={`metric-delta trend-${trend}`}>{subValue}</span>}
    </article>
  )
}

function RangeChart({ current, high, highLabel, label, low, lowLabel }: RangeChartProps) {
  const position = getPercent(current, low, high)

  return (
    <div className="range-chart">
      <div className="range-heading">
        <span>{label}</span>
        <strong>{current === null ? '-' : current.toFixed(2)}</strong>
      </div>
      <div className="range-track" aria-hidden="true">
        <span className="range-marker" style={vars({ '--position': `${position}%` })} />
      </div>
      <div className="range-scale">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  )
}

function AverageChart({ averages, current, trend }: { averages: AveragePoint[], current: number | null, trend: Trend }) {
  const values = averages
    .map((average) => average.value)
    .filter((value): value is number => value !== null)

  if (current !== null) values.push(current)

  const min = values.length ? Math.min(...values) : 0
  const max = values.length ? Math.max(...values) : 1
  const spread = max - min || 1
  const points = averages
    .map((average, index) => {
      if (average.value === null) return null

      const x = 18 + index * 66
      const y = 106 - ((average.value - min) / spread) * 74

      return `${x},${y}`
    })
    .filter((point): point is string => point !== null)
    .join(' ')
  const currentY = current === null ? null : 106 - ((current - min) / spread) * 74

  return (
    <div className="average-chart">
      <svg className="average-plot" viewBox="0 0 300 126" role="img" aria-label="移動平均線">
        <line className="plot-grid" x1="18" x2="282" y1="32" y2="32" />
        <line className="plot-grid" x1="18" x2="282" y1="69" y2="69" />
        <line className="plot-grid" x1="18" x2="282" y1="106" y2="106" />
        {currentY !== null && (
          <line className={`current-line trend-${trend}`} x1="18" x2="282" y1={currentY} y2={currentY} />
        )}
        {points && <polyline className="average-line" points={points} />}
        {averages.map((average, index) => {
          if (average.value === null) return null

          const x = 18 + index * 66
          const y = 106 - ((average.value - min) / spread) * 74

          return <circle className="average-dot" cx={x} cy={y} key={average.label} r="4" />
        })}
        {averages.map((average, index) => (
          <text className="plot-label" key={average.label} x={18 + index * 66} y="121">
            {average.label}
          </text>
        ))}
      </svg>

      <div className="average-bars">
        {averages.map((average) => (
          <div className="average-row" key={average.label}>
            <span>{average.label}</span>
            <div className="average-bar-track" aria-hidden="true">
              <span
                className="average-bar"
                style={vars({ '--bar-width': `${getBarWidth(average.value, min, max)}%` })}
              />
            </div>
            <strong>{average.display}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function PriceChart({ current, history, previousClose }: PriceChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const chart = useMemo(() => {
    const points = history.filter((point) => Number.isFinite(point.close)).slice(-260)
    const values = points.map((point) => point.close)
    const actualPrice = current ?? points[points.length - 1]?.close ?? null

    if (actualPrice !== null) values.push(actualPrice)

    if (!points.length) return null

    const rawMin = Math.min(...values)
    const rawMax = Math.max(...values)
    const padding = Math.max((rawMax - rawMin) * 0.08, rawMax * 0.01, 0.01)
    const min = rawMin - padding
    const max = rawMax + padding
    const width = 640
    const height = 286
    const left = 52
    const right = 18
    const top = 18
    const bottom = 34
    const plotWidth = width - left - right
    const plotHeight = height - top - bottom
    const spread = max - min || 1
    const getX = (index: number) => left + (index / Math.max(points.length - 1, 1)) * plotWidth
    const getY = (value: number) => top + ((max - value) / spread) * plotHeight
    const linePoints = points.map((point, index) => `${getX(index)},${getY(point.close)}`).join(' ')
    const areaPoints = `${left},${height - bottom} ${linePoints} ${getX(points.length - 1)},${height - bottom}`
    const latest = points[points.length - 1]
    const referenceClose = previousClose ?? (points.length > 0 ? points[points.length - 1].close : null)
    const dailyChange = actualPrice !== null && referenceClose !== null ? actualPrice - referenceClose : null
    const dailyChangePercent =
      dailyChange !== null && referenceClose ? (dailyChange / referenceClose) * 100 : null

    return {
      actualPrice,
      areaPoints,
      dailyChange,
      dailyChangePercent,
      getX,
      getY,
      height,
      latest,
      linePoints,
      max,
      min,
      points,
      width
    }
  }, [current, history, previousClose])

  const t = useT()

  if (!chart) {
    return <div className="price-chart-empty">{t.noChartData}</div>
  }

  const activePoint = activeIndex === null ? chart.latest : chart.points[activeIndex]
  const activeX = chart.getX(activeIndex ?? chart.points.length - 1)
  const activeY = chart.getY(activePoint.close)
  const currentTrend = getTrend(chart.dailyChange)
  const currentY = chart.actualPrice === null ? null : chart.getY(chart.actualPrice)
  const currentLabelY = currentY === null ? 0 : clamp(currentY, 30, 238)
  const mid = (chart.max + chart.min) / 2
  const dateLabels = [
    chart.points[0],
    chart.points[Math.floor(chart.points.length / 2)],
    chart.points[chart.points.length - 1]
  ]

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * chart.width
    const ratio = (x - 52) / (chart.width - 70)
    const index = Math.round(clamp(ratio, 0, 1) * (chart.points.length - 1))

    setActiveIndex(index)
  }

  return (
    <div className="price-chart">
      <div className="chart-readout">
        <div className={`actual-readout trend-${currentTrend}`}>
          <span>{t.livePrice}</span>
          <strong>{chart.actualPrice === null ? '-' : chart.actualPrice.toFixed(2)}</strong>
        </div>
        <div className={`movement-readout trend-${currentTrend}`}>
          <span>{t.dayChange}</span>
          <strong>{formatMovement(chart.dailyChange, chart.dailyChangePercent)}</strong>
        </div>
        <div className="hover-readout">
          <span>{activePoint.date}</span>
          <strong>
            {activePoint.close.toFixed(2)}
          </strong>
        </div>
      </div>

      <svg
        className="price-plot"
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        role="img"
        aria-label="一年每日收市價圖表"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setActiveIndex(null)}
      >
        <defs>
          <linearGradient id="price-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2f72da" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#2f72da" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        <line className="price-grid" x1="52" x2="622" y1="18" y2="18" />
        <line className="price-grid" x1="52" x2="622" y1="135" y2="135" />
        <line className="price-grid" x1="52" x2="622" y1="252" y2="252" />
        <text className="axis-label" x="44" y="22">{chart.max.toFixed(2)}</text>
        <text className="axis-label" x="44" y="139">{mid.toFixed(2)}</text>
        <text className="axis-label" x="44" y="256">{chart.min.toFixed(2)}</text>

        {dateLabels.map((point, index) => (
          <text className="date-label" key={`${point.date}-${index}`} x={52 + index * 285} y="280">
            {point.date.slice(5).replace('-', '/')}
          </text>
        ))}

        {currentY !== null && (
          <>
            <line className={`price-current-line trend-${currentTrend}`} x1="52" x2="622" y1={currentY} y2={currentY} />
            <g className={`current-price-tag trend-${currentTrend}`} transform={`translate(538 ${currentLabelY - 11})`}>
              <rect width="84" height="22" rx="6" />
              <text x="42" y="15">{chart.actualPrice === null ? '-' : chart.actualPrice.toFixed(2)}</text>
            </g>
          </>
        )}
        <polygon className="price-area" points={chart.areaPoints} />
        <polyline className="price-line" points={chart.linePoints} />
        <line className="crosshair" x1={activeX} x2={activeX} y1="18" y2="252" />
        <circle className="price-dot" cx={activeX} cy={activeY} r="5" />
      </svg>
    </div>
  )
}

function SidebarItem({ entry, isActive, isFav, onSelect, onToggleFav }: SidebarItemProps) {
  const t = useT()
  return (
    <div className={`sidebar-item${isActive ? ' sidebar-item-active' : ''}`}>
      <button className="sidebar-item-body" onClick={onSelect}>
        <span className="sidebar-code">{entry.number}</span>
        <span className="sidebar-name">{entry.name}</span>
        <span className="sidebar-price">{entry.price}</span>
        <span className={`sidebar-change trend-${entry.trend}`}>
          {formatMovement(entry.change, entry.changePercent)}
        </span>
      </button>
      <button
        className={`sidebar-star${isFav ? ' sidebar-star-active' : ''}`}
        onClick={onToggleFav}
        aria-label={isFav ? t.removeFav : t.addFav}
      >
        {isFav ? '★' : '☆'}
      </button>
    </div>
  )
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [stockCode, setStockCode] = useState('5')
  const [stock, setStock] = useState<StockData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sidebarTab, setSidebarTab] = useState<'fav' | 'recent'>('fav')
  const [favourites, setFavourites] = useState<SidebarEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('hkstock_fav') ?? '[]') } catch { return [] }
  })
  const [recentHistory, setRecentHistory] = useState<SidebarEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('hkstock_recent') ?? '[]') } catch { return [] }
  })
  const favouritesRef = useRef<SidebarEntry[]>(favourites)
  const [lang, setLang] = useState<Lang>(
    () => (localStorage.getItem('hkstock_lang') as Lang | null) ?? 'zh'
  )
  const [source, setSource] = useState<Source>(
    () => (localStorage.getItem('hkstock_source') as Source | null) ?? 'yahoo'
  )
  const t = translations[lang]

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    localStorage.setItem('hkstock_fav', JSON.stringify(favourites))
    favouritesRef.current = favourites
  }, [favourites])

  useEffect(() => {
    localStorage.setItem('hkstock_recent', JSON.stringify(recentHistory))
  }, [recentHistory])

  useEffect(() => { localStorage.setItem('hkstock_lang', lang) }, [lang])
  useEffect(() => { localStorage.setItem('hkstock_source', source) }, [source])

  useEffect(() => {
    const refresh = async () => {
      const current = favouritesRef.current
      if (!current.length) return
      const updated = await Promise.all(
        current.map(async (entry) => {
          try {
            const result = await window.stockAPI?.getStock(entry.number)
            return result ? stockToSidebarEntry(result) : entry
          } catch {
            return entry
          }
        })
      )
      setFavourites(updated)
    }
    const id = setInterval(refresh, 60000)
    return () => clearInterval(id)
  }, [])

  const view = useMemo(() => {
    if (!stock) return null

    const current = toNumber(stock.currentPrice)
    const todayHigh = toNumber(stock.todayTop)
    const todayLow = toNumber(stock.todayBottom)
    const week52High = toNumber(stock.week52Top)
    const week52Low = toNumber(stock.week52Bottom)
    const history = stock.history ?? []
    const fallbackPreviousClose = history.length > 0 ? history[history.length - 1].close : null
    const previousClose = toNumber(stock.previousClose ?? '') ?? fallbackPreviousClose
    const currentChange = current !== null && previousClose !== null ? current - previousClose : null
    const currentChangePercent = currentChange !== null && previousClose ? (currentChange / previousClose) * 100 : null
    const currentTrend = getTrend(currentChange)
    const averages: AveragePoint[] = [
      { label: '10日', value: toNumber(stock.avg10), display: stock.avg10 },
      { label: '20日', value: toNumber(stock.avg20), display: stock.avg20 },
      { label: '50日', value: toNumber(stock.avg50), display: stock.avg50 },
      { label: '100日', value: toNumber(stock.avg100), display: stock.avg100 },
      { label: '250日', value: toNumber(stock.avg250), display: stock.avg250 }
    ]

    return {
      averages,
      current,
      currentChange,
      currentChangePercent,
      currentTrend,
      todayHigh,
      todayLow,
      history,
      previousClose,
      week52High,
      week52Low
    }
  }, [stock])

  const keepInputFocused = () => {
    window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
  }

  const fetchStock = async (code: string) => {
    if (loading) return

    const trimmed = code.trim()

    if (!trimmed) {
      setStock(null)
      setError(t.errEnterCode)
      keepInputFocused()
      return
    }

    if (!window.stockAPI) {
      setStock(null)
      setError(t.errElectronOnly)
      keepInputFocused()
      return
    }

    try {
      setLoading(true)
      setError('')
      setStock(null)

      const result = await window.stockAPI.getStock(trimmed, source)

      setStock(result)

      const entry = stockToSidebarEntry(result)
      setRecentHistory(prev => {
        const filtered = prev.filter(e => e.number !== entry.number)
        return [entry, ...filtered].slice(0, 20)
      })
      setFavourites(prev =>
        prev.some(e => e.number === entry.number)
          ? prev.map(e => e.number === entry.number ? entry : e)
          : prev
      )
    } catch {
      setError(t.errLoadFailed)
    } finally {
      setLoading(false)
      keepInputFocused()
    }
  }

  const searchStock = () => fetchStock(stockCode)

  const loadFromSidebar = (number: string) => {
    setStockCode(number)
    fetchStock(number)
  }

  const isFav = (number: string) => favourites.some(e => e.number === number)

  const toggleFav = (number: string) => {
    if (isFav(number)) {
      setFavourites(prev => prev.filter(e => e.number !== number))
      return
    }
    if (favourites.length >= 10) {
      setError(t.errFavLimit)
      return
    }
    const entry = stock?.number === number
      ? stockToSidebarEntry(stock)
      : recentHistory.find(e => e.number === number) ?? null
    if (entry) setFavourites(prev => [...prev, entry])
  }

  const sidebarItems = sidebarTab === 'fav' ? favourites : recentHistory

  return (
    <LangContext.Provider value={t}>
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab${sidebarTab === 'fav' ? ' sidebar-tab-active' : ''}`}
            onClick={() => setSidebarTab('fav')}
          >
            {t.favTab}
          </button>
          <button
            className={`sidebar-tab${sidebarTab === 'recent' ? ' sidebar-tab-active' : ''}`}
            onClick={() => setSidebarTab('recent')}
          >
            {t.recentTab}
          </button>
        </div>

        <div className="sidebar-list">
          {sidebarItems.length === 0 ? (
            <p className="sidebar-empty">
              {sidebarTab === 'fav'
                ? <>{t.noFav}<br />{t.noFavHint}</>
                : t.noRecent}
            </p>
          ) : (
            sidebarItems.map(entry => (
              <SidebarItem
                key={entry.number}
                entry={entry}
                isActive={stock?.number === entry.number}
                isFav={isFav(entry.number)}
                onSelect={() => loadFromSidebar(entry.number)}
                onToggleFav={() => toggleFav(entry.number)}
              />
            ))
          )}
        </div>

        {sidebarTab === 'fav' && (
          <div className="sidebar-count">{favourites.length}/10</div>
        )}
      </aside>

      <div className="page">
        {loading && <div className="loading-bar" aria-hidden="true"><div className="loading-bar-inner" /></div>}

        <header className="app-header">
          <div className="title-block">
            <h1>{t.appTitle}</h1>
            <p>{stock ? `${stock.name} - ${stock.number} - ${formatSource(stock.source)}` : t.marketQuotes}</p>
          </div>

          <div className="header-right">
            <form className="search-row" onSubmit={(event) => {
              event.preventDefault()
              searchStock()
            }}>
              <input
                ref={inputRef}
                className="search-input"
                value={stockCode}
                onChange={(event) => setStockCode(event.target.value)}
                placeholder={t.searchPlaceholder}
                autoComplete="off"
              />
              <button
                className="search-button"
                type="submit"
                disabled={loading}
                onMouseDown={(event) => event.preventDefault()}
              >
                {loading ? t.searching : t.search}
              </button>
              <button
                className="lang-btn"
                type="button"
                onClick={() => setLang(l => l === 'zh' ? 'en' : 'zh')}
                aria-label="Switch language"
              >
                {lang === 'zh' ? 'EN' : '繁'}
              </button>
            </form>

            <div className="source-toggle" role="group" aria-label={t.sourceLabel}>
              {(['auto', 'etnet', 'yahoo'] as Source[]).map(s => (
                <button
                  key={s}
                  className={`source-btn${source === s ? ' source-btn-active' : ''}`}
                  onClick={() => setSource(s)}
                >
                  {s === 'auto' ? t.sourceAuto : s === 'etnet' ? 'ETNet' : 'Yahoo'}
                </button>
              ))}
            </div>
          </div>
        </header>

        <p className="status-line" role={error ? 'alert' : undefined} aria-live="polite">
          {error}
        </p>

        <main className={stock && view ? 'workspace' : 'workspace workspace-empty'}>
          {stock && view ? (
            <>
              <section className="summary-grid" aria-label={t.appTitle}>
                <MetricTile
                  label={t.currentPrice}
                  subValue={formatMovement(view.currentChange, view.currentChangePercent)}
                  tone={view.currentTrend === 'up' ? 'up' : view.currentTrend === 'down' ? 'down' : 'primary'}
                  trend={view.currentTrend}
                  value={stock.currentPrice}
                />
                <MetricTile label={t.dayHigh} value={stock.todayTop} tone="high" />
                <MetricTile label={t.dayLow} value={stock.todayBottom} tone="low" />
                <MetricTile label={t.week52Range} value={`${stock.week52Bottom} - ${stock.week52Top}`} />
              </section>

              <section className="content-grid">
                <div className="chart-panel price-panel">
                  <div className="panel-heading">
                    <h2>{t.yearChart}</h2>
                    <span>{t.dailyClose}</span>
                  </div>
                  <PriceChart current={view.current} history={view.history} previousClose={view.previousClose} />
                </div>

                <div className="chart-panel range-panel">
                  <div className="panel-heading">
                    <h2>{t.pricePosition}</h2>
                    <span>{t.vsRange}</span>
                  </div>
                  <div className="range-list">
                    <RangeChart
                      current={view.current}
                      high={view.todayHigh}
                      highLabel={stock.todayTop}
                      label={t.today}
                      low={view.todayLow}
                      lowLabel={stock.todayBottom}
                    />
                    <RangeChart
                      current={view.current}
                      high={view.week52High}
                      highLabel={stock.week52Top}
                      label={t.week52}
                      low={view.week52Low}
                      lowLabel={stock.week52Bottom}
                    />
                  </div>
                </div>

                <div className="chart-panel averages-panel">
                  <div className="panel-heading">
                    <h2>{t.movingAvg}</h2>
                    <span>{t.tenTo250d}</span>
                  </div>
                  <AverageChart averages={view.averages} current={view.current} trend={view.currentTrend} />
                </div>
              </section>
            </>
          ) : (
            <section className="empty-state" aria-label={t.noStockLoaded}>
              <div className="placeholder-chart" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <p className="empty-copy">{t.emptyInstruction}</p>
            </section>
          )}
        </main>
      </div>
    </div>
    </LangContext.Provider>
  )
}

export default App
