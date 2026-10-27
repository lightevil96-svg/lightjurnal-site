(function () {
  "use strict";

  const STORAGE_TRADES = "tradelog.trades.v1";
  const STORAGE_SETTINGS = "tradelog.settings.v1";
  const CURRENCIES = ["USD", "IDR", "EUR", "GBP", "SGD", "AUD"];
  const MARKETS = ["Forex", "Crypto", "Saham", "Indeks", "Komoditas", "Futures", "Lainnya"];
  const TITLES = {
    overview: "Ringkasan",
    trades: "Riwayat Trade",
    analytics: "Analisis Performa",
    risk: "Kalkulator Risiko",
    mt5: "MT5 Live",
    settings: "Pengaturan & Cadangan"
  };

  let trades = [];
  let settings = { currency: "USD", startingBalance: 10000 };
  let currentPage = "overview";
  let searchText = "";
  let marketFilter = "all";
  let outcomeFilter = "all";
  let editingId = null;
  let mt5PollTimer = null;
  let mt5LastSnapshot = null;

  const $ = function (selector, root) { return (root || document).querySelector(selector); };
  const $$ = function (selector, root) { return Array.from((root || document).querySelectorAll(selector)); };
  const content = $("#page-content");

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function validDate(value) {
    const text = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return todayISO();
    const parts = text.split("-").map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    return date.getFullYear() === parts[0] && date.getMonth() === parts[1] - 1 && date.getDate() === parts[2]
      ? text
      : todayISO();
  }

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "trade-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  }

  function normalizeTrade(item) {
    const source = item && typeof item === "object" ? item : {};
    const entry = numberOrNull(source.entry);
    const exit = numberOrNull(source.exit);
    const manualNet = numberOrNull(source.manualNet);
    return {
      id: String(source.id || makeId()),
      date: validDate(source.date),
      symbol: String(source.symbol || "").trim().slice(0, 80),
      market: MARKETS.indexOf(source.market) >= 0 ? source.market : "Lainnya",
      side: source.side === "Short" ? "Short" : "Long",
      strategy: String(source.strategy || "").trim().slice(0, 100),
      entry: entry,
      exit: exit,
      stop: numberOrNull(source.stop),
      size: Math.max(0, numberOrNull(source.size) || 0),
      multiplier: Math.max(0, numberOrNull(source.multiplier) || 1),
      fees: Math.max(0, numberOrNull(source.fees) || 0),
      riskAmount: Math.max(0, numberOrNull(source.riskAmount) || 0),
      manualNet: manualNet,
      notes: String(source.notes || "").slice(0, 3000)
    };
  }

  function loadData() {
    try {
      const storedTrades = localStorage.getItem(STORAGE_TRADES);
      const storedSettings = localStorage.getItem(STORAGE_SETTINGS);
      if (storedTrades) {
        const parsed = JSON.parse(storedTrades);
        if (Array.isArray(parsed)) trades = parsed.map(normalizeTrade);
      }
      if (storedSettings) {
        const parsedSettings = JSON.parse(storedSettings);
        if (parsedSettings && typeof parsedSettings === "object") {
          settings.currency = CURRENCIES.indexOf(parsedSettings.currency) >= 0 ? parsedSettings.currency : "USD";
          settings.startingBalance = Math.max(0, numberOrNull(parsedSettings.startingBalance) || 0);
        }
      }
    } catch (error) {
      showToast("Data lokal tidak dapat dibaca. Coba pulihkan dari backup JSON.");
      console.error("TradeLog local data error:", error);
    }
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_TRADES, JSON.stringify(trades));
      localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings));
      return true;
    } catch (error) {
      showToast("Penyimpanan gagal. Periksa ruang browser atau ekspor backup.");
      console.error("TradeLog save error:", error);
      return false;
    }
  }

  function formatMoney(value, short) {
    if (!Number.isFinite(Number(value))) return "—";
    const decimals = settings.currency === "IDR" ? 0 : 2;
    try {
      return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: settings.currency,
        notation: short ? "compact" : "standard",
        maximumFractionDigits: short ? 1 : decimals,
        minimumFractionDigits: short ? 0 : decimals
      }).format(Number(value));
    } catch (error) {
      return Number(value).toLocaleString("id-ID", { maximumFractionDigits: decimals }) + " " + settings.currency;
    }
  }

  function formatDate(value, withYear) {
    if (!value) return "—";
    const d = new Date(value + "T12:00:00");
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("id-ID", withYear ? { day: "2-digit", month: "short", year: "numeric" } : { day: "2-digit", month: "short" }).format(d);
  }

  function formatNumber(value, digits) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
    return new Intl.NumberFormat("id-ID", { maximumFractionDigits: digits === undefined ? 2 : digits }).format(Number(value));
  }

  function calcTrade(trade) {
    const hasManual = trade.manualNet !== null && trade.manualNet !== undefined && Number.isFinite(Number(trade.manualNet));
    const isClosed = (trade.exit !== null && trade.exit !== undefined) || hasManual;
    let pnl = 0;
    if (hasManual) {
      pnl = Number(trade.manualNet);
    } else if (trade.entry !== null && trade.exit !== null && trade.size > 0 && trade.multiplier > 0) {
      const direction = trade.side === "Short" ? -1 : 1;
      pnl = (trade.exit - trade.entry) * trade.size * trade.multiplier * direction - trade.fees;
    }
    let risk = trade.riskAmount > 0 ? trade.riskAmount : 0;
    if (!risk && trade.entry !== null && trade.stop !== null && trade.size > 0 && trade.multiplier > 0) {
      risk = Math.abs(trade.entry - trade.stop) * trade.size * trade.multiplier;
    }
    return {
      isClosed: isClosed,
      pnl: isClosed ? pnl : 0,
      risk: risk,
      rMultiple: isClosed && risk > 0 ? pnl / risk : null,
      outcome: !isClosed ? "Open" : pnl > 0.0000001 ? "Win" : pnl < -0.0000001 ? "Loss" : "BE"
    };
  }

  function closedTrades() {
    return trades.filter(function (trade) { return calcTrade(trade).isClosed; });
  }

  function closedSortedAscending() {
    return closedTrades().slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
  }

  function sumPnl(list) {
    return list.reduce(function (sum, trade) { return sum + calcTrade(trade).pnl; }, 0);
  }

  function getStats(list) {
    const closed = list.filter(function (trade) { return calcTrade(trade).isClosed; });
    const wins = closed.filter(function (trade) { return calcTrade(trade).pnl > 0.0000001; });
    const losses = closed.filter(function (trade) { return calcTrade(trade).pnl < -0.0000001; });
    const breakeven = closed.length - wins.length - losses.length;
    const grossProfit = wins.reduce(function (sum, trade) { return sum + calcTrade(trade).pnl; }, 0);
    const grossLoss = Math.abs(losses.reduce(function (sum, trade) { return sum + calcTrade(trade).pnl; }, 0));
    const pnl = sumPnl(closed);
    return {
      closed: closed,
      wins: wins,
      losses: losses,
      breakeven: breakeven,
      pnl: pnl,
      count: closed.length,
      winRate: closed.length ? wins.length / closed.length * 100 : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : null),
      avgR: closed.filter(function (trade) { return calcTrade(trade).rMultiple !== null; }).length
        ? closed.reduce(function (sum, trade) { return sum + (calcTrade(trade).rMultiple === null ? 0 : calcTrade(trade).rMultiple); }, 0) /
          closed.filter(function (trade) { return calcTrade(trade).rMultiple !== null; }).length
        : null
    };
  }

  function moneyClass(value) {
    return value > 0.0000001 ? "positive" : value < -0.0000001 ? "negative" : "neutral";
  }

  function displayProfitFactor(value) {
    if (value === null) return "—";
    return value === Infinity ? "∞" : formatNumber(value, 2);
  }

  function metricCard(label, value, caption, icon, tone, valueClass) {
    return '<div class="card metric-card"><div class="metric-top"><span>' + label + '</span><span class="metric-icon ' + tone + '">' + icon + '</span></div>' +
      '<div class="metric-value ' + (valueClass || "") + '">' + value + '</div><div class="metric-caption">' + caption + '</div></div>';
  }

  function emptyState(title, description, actionLabel) {
    return '<div class="empty-state"><div class="empty-state-icon">↗</div><h3>' + title + '</h3><p>' + description + '</p>' +
      (actionLabel ? '<button class="button button-primary" data-action="new-trade">' + actionLabel + '</button>' : "") + '</div>';
  }

  function renderPage() {
    $("#page-title").textContent = TITLES[currentPage] || TITLES.overview;
    $$(".nav-item[data-page]").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.page === currentPage);
    });
    $("#nav-trade-count").textContent = String(trades.length);
    $("#today-date").textContent = new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "2-digit", month: "short" }).format(new Date());
    document.body.classList.remove("sidebar-open");
    if (mt5PollTimer) { window.clearInterval(mt5PollTimer); mt5PollTimer = null; }
    if (currentPage === "overview") renderOverview();
    else if (currentPage === "trades") renderTradesPage();
    else if (currentPage === "analytics") renderAnalytics();
    else if (currentPage === "risk") renderRisk();
    else if (currentPage === "mt5") { renderMT5(); startMT5Polling(); }
    else renderSettings();
  }


  function getMT5Config() {
    let endpoint = window.location.origin + "/api/mt5";
    let apiKey = "";
    try {
      endpoint = (window.localStorage.getItem("tradelog.mt5.endpoint") || endpoint).trim();
      apiKey = window.sessionStorage.getItem("tradelog.mt5.key") || "";
    } catch (error) {}
    return { endpoint: endpoint.replace(/\/+$/, ""), apiKey: apiKey };
  }

  function renderMT5() {
    const config = getMT5Config();
    const symbol = "OANDA:XAUUSD";
    content.innerHTML = '<div class="page-intro"><div><h2>Akun MetaTrader 5</h2><p>Chart pasar live dan panel akun investor melalui bridge MT5 yang kamu host sendiri.</p></div><span class="pill amber" id="mt5-status-pill">BELUM TERHUBUNG</span></div>' +
      '<div class="mt5-warning"><strong>Keamanan akun</strong><p>Jangan masukkan password investor MT5 ke halaman web. Login MT5 dilakukan di terminal pada server/VPS milikmu; halaman ini hanya menerima API key bridge dan data baca-saja. Jangan membuka bridge ke internet tanpa HTTPS dan pembatasan akses.</p></div>' +
      '<section class="card mt5-connection-card"><div class="card-header"><div><h3 class="section-title">Koneksi bridge</h3><p class="section-subtitle">Backend MT5 harus aktif di Windows VPS/PC yang menjalankan terminal MetaTrader 5.</p></div><button class="button button-secondary" data-action="mt5-refresh">↻ Perbarui</button></div>' +
      '<div class="mt5-connection-form"><label>URL API bridge<input id="mt5-endpoint" type="url" placeholder="https://domain-kamu.com/api/mt5" value="' + escapeHtml(config.endpoint) + '" autocomplete="url"></label><label>API key bridge<input id="mt5-api-key" type="password" placeholder="API key (hanya sesi ini)" autocomplete="off" value="' + escapeHtml(config.apiKey) + '"></label><button class="button button-primary" data-action="mt5-connect">Hubungkan</button><button class="button button-secondary" data-action="mt5-disconnect">Putuskan</button></div>' +
      '<p class="mt5-help">API key disimpan di session browser sampai tab/sesi berakhir. Endpoint wajib memakai HTTPS kecuali localhost. Koneksi membaca snapshot akun dan posisi; tidak ada fungsi untuk membuka/menutup order.</p></section>' +
      '<div id="mt5-account-panel"><div class="mt5-state-card"><span class="mt5-state-icon">⌁</span><strong>Menunggu koneksi bridge</strong><p>Isi URL API dan API key setelah backend MT5 dipasang. Chart pasar di bawah tetap dapat digunakan tanpa koneksi akun.</p></div></div>' +
      '<section class="card mt5-chart-card"><div class="card-header"><div><h3 class="section-title">Chart pasar</h3><p class="section-subtitle">Chart TradingView. Harga bisa berbeda dari feed broker HFM.</p></div><div class="mt5-chart-controls"><label class="mt5-symbol-label">Instrumen<select id="mt5-symbol"><option value="OANDA:XAUUSD" selected>Gold / XAUUSD</option><option value="FX:EURUSD">EUR/USD</option><option value="FX:GBPUSD">GBP/USD</option><option value="FX:USDJPY">USD/JPY</option><option value="BINANCE:BTCUSDT">BTC/USDT</option><option value="NASDAQ:NDX">Nasdaq 100</option></select></label><label class="mt5-symbol-label">Timeframe<select id="mt5-interval"><option value="5">M5</option><option value="15" selected>M15</option><option value="60">H1</option><option value="240">H4</option><option value="D">D1</option></select></label></div></div><div class="mt5-chart-frame"><iframe id="mt5-chart-frame" title="Chart XAUUSD TradingView" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen src="' + tradingViewChartUrl(symbol, "15") + '"></iframe></div></section>' +
      '<section class="card mt5-analysis-card"><div class="card-header"><div><h3 class="section-title">Analisis teknikal otomatis</h3><p class="section-subtitle">Ringkasan indikator TradingView untuk instrumen dan timeframe terpilih.</p></div><span class="pill blue">OTOMATIS</span></div><div class="mt5-analysis-note">Widget ini merangkum indikator teknikal dari TradingView, bukan analisis AI ChatGPT atau sinyal dari server HFM. Gunakan bersama struktur harga dan manajemen risiko.</div><div id="mt5-technical-analysis" class="mt5-technical-analysis"><div class="mt5-state-card"><strong>Memuat ringkasan indikator…</strong><p>Menunggu widget TradingView.</p></div></div><div class="mt5-analysis-footer"><span id="mt5-analysis-label">OANDA:XAUUSD · M15</span><span>Data pihak ketiga; bisa tertunda atau berbeda dari HFM.</span></div></section>' +
      '<section class="card mt5-ai-analysis-card"><div class="card-header"><div><h3 class="section-title">Analisis XAUUSD</h3><p class="section-subtitle">Baca tren, momentum, volatilitas, dan level teknikal dari candle terbaru.</p></div><span class="pill blue">LIVE DATA</span></div><div class="mt5-ai-analysis-body"><div class="mt5-ai-analysis-intro"><p>Analisis otomatis berbasis indikator teknikal, bukan AI ChatGPT. Feed yang digunakan adalah futures emas GC=F sebagai proksi, sehingga harga dapat berbeda dari XAUUSD di broker HFM.</p><button class="button button-primary" data-action="mt5-run-analysis" id="mt5-run-analysis">↗ Analisis sekarang</button></div><div id="mt5-analysis-result" aria-live="polite"><div class="mt5-state-card"><strong>Siap menganalisis</strong><p>Tekan tombol untuk mengambil candle terbaru dan menghitung indikator.</p></div></div></div></section>' +
      '<section class="card mt5-positions-card"><div class="card-header"><div><h3 class="section-title">Posisi terbuka</h3><p class="section-subtitle">Diambil dari snapshot akun MT5 saat bridge tersedia.</p></div><span class="pill gray" id="mt5-position-count">0 posisi</span></div><div id="mt5-positions-list"><div class="mt5-empty-positions">Belum ada data posisi.</div></div></section>';
    mountTradingViewTechnicalAnalysis(symbol, "15");
  }

  function tradingViewChartUrl(symbol, interval) {
    const chartInterval = String(interval || "15") === "D" ? "1D" : String(interval || "15");
    return "https://s.tradingview.com/widgetembed/?frameElementId=tradelog_mt5_chart&symbol=" + encodeURIComponent(symbol) +
      "&interval=" + encodeURIComponent(chartInterval) + "&hidesidetoolbar=0&symboledit=1&saveimage=1&toolbarbg=%23f1f3f6&studies=%5B%5D&theme=light&style=1&timezone=Asia%2FJakarta&withdateranges=1&hide_side_toolbar=0&allow_symbol_change=1&details=1&hotlist=1&calendar=0";
  }

  function tradingViewAnalysisInterval(value) {
    return ({ "5": "5m", "15": "15m", "60": "1h", "240": "4h", "D": "1D" })[String(value || "15")] || "15m";
  }

  function mountTradingViewTechnicalAnalysis(symbol, interval) {
    const host = $("#mt5-technical-analysis");
    const label = $("#mt5-analysis-label");
    if (!host) return;
    const ticker = symbol || "OANDA:XAUUSD";
    const widgetInterval = tradingViewAnalysisInterval(interval);
    if (label) label.textContent = ticker + " · " + ({ "5m": "M5", "15m": "M15", "1h": "H1", "4h": "H4", "1D": "D1" })[widgetInterval];
    host.innerHTML = "";
    const container = document.createElement("div");
    container.className = "tradingview-widget-container";
    container.style.width = "100%";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    container.appendChild(widget);
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js";
    script.async = true;
    script.text = JSON.stringify({
      interval: widgetInterval,
      width: "100%",
      isTransparent: false,
      height: "420",
      symbol: ticker,
      showIntervalTabs: true,
      displayMode: "single",
      locale: "id",
      colorTheme: "light"
    });
    container.appendChild(script);
    host.appendChild(container);
  }


  function emaSeries(values, period) {
    if (!values.length) return [];
    const multiplier = 2 / (period + 1);
    let current = values[0];
    return values.map(function (value, index) { current = index === 0 ? value : value * multiplier + current * (1 - multiplier); return current; });
  }
  function calculateRSI(closes, period) {
    if (closes.length <= period) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) { const change = closes[i] - closes[i - 1]; if (change > 0) gains += change; else losses -= change; }
    let avgGain = gains / period, avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i++) { const change = closes[i] - closes[i - 1]; avgGain = (avgGain * (period - 1) + Math.max(0, change)) / period; avgLoss = (avgLoss * (period - 1) + Math.max(0, -change)) / period; }
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
  }
  function formatGoldPrice(value) { return Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function analysisMetric(label, value, note) { return '<div class="mt5-analysis-metric"><span>' + label + '</span><strong>' + value + '</strong><small>' + note + '</small></div>'; }

  async function runMT5MarketAnalysis(button) {
    const output = $("#mt5-analysis-result");
    const interval = ($("#mt5-interval") || {}).value || "15";
    const intervalMap = { "5": "5m", "15": "15m", "60": "60m", "240": "60m", "D": "1d" };
    const rangeMap = { "5": "5d", "15": "5d", "60": "1mo", "240": "3mo", "D": "1y" };
    if (!output) return;
    if (button) { button.disabled = true; button.textContent = "Mengambil data…"; }
    output.innerHTML = '<div class="mt5-state-card"><strong>Mengambil candle pasar terbaru…</strong><p>Menghitung EMA, RSI, ATR, momentum, dan support/resistance.</p></div>';
    try {
      const endpoint = "https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?range=" + encodeURIComponent(rangeMap[interval] || "5d") + "&interval=" + encodeURIComponent(intervalMap[interval] || "15m");
      let data;
      try {
        const direct = await fetch(endpoint, { cache: "no-store" });
        if (!direct.ok) throw new Error("Sumber langsung tidak tersedia");
        data = await direct.json();
        if (!data || !data.chart) throw new Error("Format sumber langsung tidak sesuai");
      } catch (directError) {
        const proxy = await fetch("https://proxy.cors.dev/" + endpoint, { cache: "no-store" });
        if (!proxy.ok) throw new Error("Sumber harga tidak merespons (HTTP " + proxy.status + ")");
        data = await proxy.json();
      }
      renderMT5MarketAnalysisFromData(data, output, interval);
    } catch (error) {
      output.innerHTML = '<div class="mt5-state-card"><strong>Data pasar belum bisa diambil</strong><p>' + escapeHtml(error && error.message ? error.message : "Koneksi gagal.") + ' Coba lagi beberapa saat. Analisis tidak dibuat dari harga tebakan.</p></div>';
    } finally {
      if (button) { button.disabled = false; button.textContent = "↻ Analisis sekarang"; }
    }
  }

  function renderMT5MarketAnalysisFromData(data, output, interval) {
    const result = data && data.chart && data.chart.result && data.chart.result[0];
    if (!result) throw new Error("Data candle kosong atau tidak tersedia.");
    const quote = result.indicators && result.indicators.quote && result.indicators.quote[0], timestamps = result.timestamp || [];
    if (!quote || !quote.close) throw new Error("Data candle tidak lengkap.");
    const bars = timestamps.map(function (timestamp, i) { return { time: timestamp, open: quote.open && quote.open[i], high: quote.high && quote.high[i], low: quote.low && quote.low[i], close: quote.close[i] }; })
      .filter(function (bar) { return Number.isFinite(bar.open) && Number.isFinite(bar.high) && Number.isFinite(bar.low) && Number.isFinite(bar.close); });
    if (bars.length < 30) throw new Error("Jumlah candle belum cukup untuk analisis yang layak.");
    const closes = bars.map(function (bar) { return bar.close; }), last = bars[bars.length - 1];
    const ema9 = emaSeries(closes, 9), ema21 = emaSeries(closes, 21), ema12 = emaSeries(closes, 12), ema26 = emaSeries(closes, 26);
    const macd = ema12.map(function (value, i) { return value - ema26[i]; }), macdSignal = emaSeries(macd, 9), rsi = calculateRSI(closes, 14);
    const trueRanges = [];
    for (let i = 1; i < bars.length; i++) trueRanges.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close)));
    const atrValues = trueRanges.slice(-14), atr = atrValues.reduce(function (sum, value) { return sum + value; }, 0) / atrValues.length;
    const recent = bars.slice(-20), support = Math.min.apply(null, recent.map(function (bar) { return bar.low; })), resistance = Math.max.apply(null, recent.map(function (bar) { return bar.high; }));
    const isBull = ema9[ema9.length - 1] > ema21[ema21.length - 1], isBear = ema9[ema9.length - 1] < ema21[ema21.length - 1];
    const macdBull = macd[macd.length - 1] > macdSignal[macdSignal.length - 1], macdBear = macd[macd.length - 1] < macdSignal[macdSignal.length - 1];
    let bias = "NETRAL / TUNGGU", tone = "amber", explanation = "Sinyal belum searah. Tunggu konfirmasi candle dan jangan memaksakan entry.";
    if (isBull && macdBull && rsi >= 52 && rsi < 70) { bias = "BIAS BULLISH"; tone = "green"; explanation = "EMA pendek di atas EMA panjang, momentum MACD positif, dan RSI mendukung kenaikan. Cari konfirmasi lanjutan; hindari mengejar harga."; }
    else if (isBear && macdBear && rsi <= 48 && rsi > 30) { bias = "BIAS BEARISH"; tone = "red"; explanation = "EMA pendek di bawah EMA panjang, momentum MACD negatif, dan RSI mendukung pelemahan. Tunggu konfirmasi; waspadai pantulan."; }
    else if (rsi >= 70) explanation = "RSI berada di area tinggi; risiko koreksi meningkat. Overbought bukan sinyal jual otomatis.";
    else if (rsi <= 30) explanation = "RSI berada di area rendah; pantulan mungkin terjadi, tetapi belum menjadi sinyal beli tanpa konfirmasi.";
    const stamp = new Date(last.time * 1000), timeframeLabel = ({ "5": "M5", "15": "M15", "60": "H1", "240": "H4 (data H1)", "D": "D1" })[interval] || "M15";
    const scenario = tone === "green"
      ? '<div class="mt5-scenario"><strong>Referensi skenario bullish (bukan sinyal entry)</strong><span>Invalidasi ilustratif: ' + formatGoldPrice(last.close - atr * 1.5) + '</span><span>Target ATR 1,5×: ' + formatGoldPrice(last.close + atr * 1.5) + '</span><span>Target ATR 2,5×: ' + formatGoldPrice(last.close + atr * 2.5) + '</span></div>'
      : tone === "red"
        ? '<div class="mt5-scenario"><strong>Referensi skenario bearish (bukan sinyal entry)</strong><span>Invalidasi ilustratif: ' + formatGoldPrice(last.close + atr * 1.5) + '</span><span>Target ATR 1,5×: ' + formatGoldPrice(last.close - atr * 1.5) + '</span><span>Target ATR 2,5×: ' + formatGoldPrice(last.close - atr * 2.5) + '</span></div>'
        : '<div class="mt5-scenario"><strong>Belum ada rencana entry</strong><span>Tunggu tren dan momentum lebih selaras sebelum menentukan risiko.</span></div>';
    output.innerHTML = '<div class="mt5-analysis-summary"><div><span class="mt5-analysis-kicker">BIAS TEKNIKAL · ' + timeframeLabel + '</span><h4 class="mt5-bias ' + tone + '">' + bias + '</h4><p>' + explanation + '</p></div><div class="mt5-current-price"><small>Harga candle terakhir (GC=F)</small><strong>' + formatGoldPrice(last.close) + '</strong><span>' + stamp.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }) + ' WIB</span></div></div>' +
      '<div class="mt5-analysis-metrics">' +
      analysisMetric("EMA 9 / EMA 21", formatGoldPrice(ema9[ema9.length - 1]) + " / " + formatGoldPrice(ema21[ema21.length - 1]), isBull ? "Tren pendek naik" : isBear ? "Tren pendek turun" : "Tren mendatar") +
      analysisMetric("RSI (14)", rsi.toFixed(1), rsi >= 70 ? "Area tinggi" : rsi <= 30 ? "Area rendah" : rsi >= 50 ? "Momentum di atas 50" : "Momentum di bawah 50") +
      analysisMetric("MACD", macdBull ? "Positif" : "Negatif", "Dibanding garis sinyal") +
      analysisMetric("ATR (14)", formatGoldPrice(atr), "Perkiraan rentang candle") +
      analysisMetric("Support (20 candle)", formatGoldPrice(support), "Area terendah terbaru") +
      analysisMetric("Resistance (20 candle)", formatGoldPrice(resistance), "Area tertinggi terbaru") +
      '</div>' + scenario + '<p class="mt5-analysis-disclaimer">Data Yahoo Finance GC=F (futures emas), bukan kuotasi XAUUSD HFM; bisa terlambat atau berbeda. Ini bukan nasihat keuangan dan tidak menjamin hasil.</p>';
  }

  function startMT5Polling() {
    if (currentPage !== "mt5") return;
    refreshMT5Snapshot();
    mt5PollTimer = window.setInterval(function () {
      if (currentPage === "mt5") refreshMT5Snapshot();
    }, 10000);
  }

  async function refreshMT5Snapshot() {
    if (currentPage !== "mt5") return;
    const config = getMT5Config();
    if (!config.apiKey || !config.endpoint) {
      setMT5Offline("Bridge belum dikonfigurasi", "Masukkan URL dan API key bridge. Jangan masukkan password investor MT5 di sini.");
      return;
    }
    try {
      const endpoint = config.endpoint.replace(/\/+$/, "");
      const parsedEndpoint = new URL(endpoint);
      const isLocal = parsedEndpoint.hostname === "localhost" || parsedEndpoint.hostname === "127.0.0.1";
      if (parsedEndpoint.protocol !== "https:" && !isLocal) {
        throw new Error("Gunakan URL HTTPS untuk koneksi bridge, atau localhost untuk pengujian lokal.");
      }
      const response = await fetch(endpoint + "/snapshot", {
        method: "GET",
        headers: { "Authorization": "Bearer " + config.apiKey, "Accept": "application/json" },
        credentials: "omit",
        cache: "no-store"
      });
      if (!response.ok) throw new Error(response.status === 401 ? "API key ditolak." : "Bridge merespons HTTP " + response.status + ".");
      const data = await response.json();
      if (!data || data.connected !== true || !data.account || !Array.isArray(data.positions)) {
        throw new Error("Format snapshot bridge tidak sesuai kontrak API.");
      }
      mt5LastSnapshot = data;
      renderMT5Snapshot(data);
    } catch (error) {
      setMT5Offline("Koneksi belum tersedia", error && error.message ? error.message : "Tidak dapat menjangkau bridge MT5.");
    }
  }

  function setMT5Offline(title, detail) {
    const pill = $("#mt5-status-pill");
    if (pill) { pill.textContent = "OFFLINE"; pill.className = "pill red"; }
    const panel = $("#mt5-account-panel");
    if (panel) panel.innerHTML = '<div class="mt5-state-card"><span class="mt5-state-icon">!</span><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(detail) + '</p><small>Refresh otomatis setiap 10 detik selama halaman MT5 Live terbuka.</small></div>';
    const positions = $("#mt5-positions-list");
    if (positions) positions.innerHTML = '<div class="mt5-empty-positions">Tidak ada data posisi dari bridge.</div>';
    const count = $("#mt5-position-count");
    if (count) count.textContent = "— posisi";
  }

  function renderMT5Snapshot(data) {
    const account = data.account || {};
    const money = function (value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return "—";
      return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(n) + (account.currency ? " " + escapeHtml(account.currency) : "");
    };
    const pill = $("#mt5-status-pill");
    if (pill) { pill.textContent = "TERHUBUNG"; pill.className = "pill green"; }
    const panel = $("#mt5-account-panel");
    if (panel) panel.innerHTML = '<div class="metric-grid mt5-metric-grid">' +
      metricCard("Saldo", money(account.balance), "Balance akun broker", "◉", "blue", "") +
      metricCard("Equity", money(account.equity), "Saldo + floating P/L", "↗", "green", "") +
      metricCard("Floating P/L", money(account.profit), "P/L posisi terbuka", "⌁", Number(account.profit) >= 0 ? "green" : "red", Number(account.profit) >= 0 ? "positive" : "negative") +
      metricCard("Free margin", money(account.freeMargin), "Margin bebas tersedia", "◇", "amber", "") + '</div>' +
      '<div class="mt5-account-meta"><span>Akun: <strong>' + escapeHtml(account.login || "—") + '</strong></span><span>Server: <strong>' + escapeHtml(account.server || "—") + '</strong></span><span>Leverage: <strong>' + escapeHtml(account.leverage ? "1:" + account.leverage : "—") + '</strong></span><span>Sinkron terakhir: <strong>' + escapeHtml(data.timestamp || new Date().toISOString()) + '</strong></span></div>';
    const positions = $("#mt5-positions-list");
    const count = $("#mt5-position-count");
    const list = data.positions || [];
    if (count) count.textContent = list.length + " posisi";
    if (positions) {
      if (!list.length) positions.innerHTML = '<div class="mt5-empty-positions">Tidak ada posisi terbuka saat ini.</div>';
      else positions.innerHTML = '<div class="table-scroll"><table><thead><tr><th>Simbol</th><th>Tipe</th><th>Volume</th><th>Harga buka</th><th>Harga saat ini</th><th>Floating P/L</th></tr></thead><tbody>' + list.map(function (position) {
        return '<tr><td><strong>' + escapeHtml(position.symbol || "—") + '</strong></td><td>' + escapeHtml(position.type || "—") + '</td><td>' + escapeHtml(position.volume == null ? "—" : position.volume) + '</td><td>' + escapeHtml(position.priceOpen == null ? "—" : position.priceOpen) + '</td><td>' + escapeHtml(position.priceCurrent == null ? "—" : position.priceCurrent) + '</td><td class="' + (Number(position.profit) >= 0 ? "positive" : "negative") + '">' + money(position.profit) + '</td></tr>';
      }).join("") + '</tbody></table></div>';
    }
  }

  function saveMT5Config() {
    const endpointInput = $("#mt5-endpoint");
    const keyInput = $("#mt5-api-key");
    if (!endpointInput || !keyInput) return false;
    const endpoint = endpointInput.value.trim().replace(/\/+$/, "");
    const key = keyInput.value.trim();
    if (!endpoint || !key) {
      showToast("Isi URL API bridge dan API key. Password MT5 tidak diperlukan.");
      return false;
    }
    try {
      const parsed = new URL(endpoint);
      const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (parsed.protocol !== "https:" && !isLocal) {
        showToast("URL bridge harus HTTPS kecuali localhost untuk pengujian.");
        return false;
      }
      window.localStorage.setItem("tradelog.mt5.endpoint", endpoint);
      window.sessionStorage.setItem("tradelog.mt5.key", key);
      showToast("Konfigurasi bridge disimpan; API key hanya berlaku untuk sesi browser ini.");
      refreshMT5Snapshot();
      return true;
    } catch (error) {
      showToast("URL bridge tidak valid.");
      return false;
    }
  }

  function disconnectMT5() {
    try { window.sessionStorage.removeItem("tradelog.mt5.key"); } catch (error) {}
    mt5LastSnapshot = null;
    setMT5Offline("Koneksi diputuskan", "API key dihapus dari sesi browser. URL bridge tetap tersimpan.");
    const keyInput = $("#mt5-api-key");
    if (keyInput) keyInput.value = "";
  }

  function renderOverview() {
    const stats = getStats(trades);
    const equity = settings.startingBalance + stats.pnl;
    const allSorted = trades.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    let html = '<div class="page-intro"><div><h2>Selamat datang kembali 👋</h2><p>Ringkas transaksi dan evaluasi kualitas keputusan trading kamu.</p></div>' +
      '<button class="button button-secondary" data-action="export-csv">↓ Ekspor CSV</button></div>';
    html += '<div class="metric-grid">' +
      metricCard("Total P/L bersih", formatMoney(stats.pnl), '<span class="' + moneyClass(stats.pnl) + '">' + (stats.pnl > 0 ? "▲" : stats.pnl < 0 ? "▼" : "•") + " Hasil semua trade tertutup</span>", "↗", stats.pnl >= 0 ? "green" : "red", moneyClass(stats.pnl)) +
      metricCard("Win rate", formatNumber(stats.winRate, 1) + "%", stats.count ? stats.wins.length + " menang dari " + stats.count + " trade tertutup" : "Menunggu trade pertama", "◎", "blue", "") +
      metricCard("Total trade", String(trades.length), stats.closed.length + " tertutup · " + (trades.length - stats.closed.length) + " terbuka", "↕", "amber", "") +
      metricCard("Profit factor", displayProfitFactor(stats.profitFactor), stats.profitFactor === Infinity ? "Profit tanpa trade rugi" : "Gross profit ÷ gross loss", "⌁", "green", "") +
      '</div>';
    html += '<div class="dashboard-grid"><section class="card chart-card"><div class="card-header"><div><div class="chart-heading"><h3 class="section-title">Kurva ekuitas</h3><span class="pill ' + (stats.pnl >= 0 ? "green" : "red") + '">' + (stats.pnl >= 0 ? "+" : "") + formatNumber(stats.pnl / Math.max(settings.startingBalance, 1) * 100, 2) + '%</span></div><p class="section-subtitle">Akumulasi P/L dari trade yang sudah ditutup</p></div><div class="chart-legend"><span class="legend-dot"></span><span>P/L kumulatif</span></div></div>' +
      '<div class="chart-wrap">' + renderEquityChart() + '</div></section>';
    const closed = stats.closed.length;
    const winDegrees = closed ? stats.wins.length / closed * 360 : 0;
    const lossDegrees = closed ? (stats.wins.length + stats.losses.length) / closed * 360 : 0;
    html += '<section class="card"><div class="card-header"><div><h3 class="section-title">Kualitas hasil</h3><p class="section-subtitle">Distribusi trade tertutup</p></div></div><div class="insight-stack">' +
      '<div class="winrate-layout"><div class="donut" style="background:conic-gradient(#1aa879 0deg ' + winDegrees + 'deg,#d95563 ' + winDegrees + 'deg ' + lossDegrees + 'deg,#edf0f5 ' + lossDegrees + 'deg 360deg)"><div class="donut-center"><strong>' + formatNumber(stats.winRate, 0) + '%</strong><small>Win rate</small></div></div><div class="winrate-legend">' +
      '<div class="legend-row"><span class="legend-label"><i class="legend-swatch" style="background:#1aa879"></i>Menang</span><strong>' + stats.wins.length + '</strong></div>' +
      '<div class="legend-row"><span class="legend-label"><i class="legend-swatch" style="background:#d95563"></i>Kalah</span><strong>' + stats.losses.length + '</strong></div>' +
      '<div class="legend-row"><span class="legend-label"><i class="legend-swatch" style="background:#d8dee8"></i>Impas</span><strong>' + stats.breakeven + '</strong></div></div></div><div class="divider"></div>' +
      '<div class="insight-row"><div><small>Saldo awal</small><strong>' + formatMoney(settings.startingBalance) + '</strong></div><div style="text-align:right"><small>Estimasi saldo</small><strong>' + formatMoney(equity) + '</strong></div></div>' +
      '<div class="insight-row"><div><small>Rata-rata R</small><strong class="' + (stats.avgR === null ? "neutral" : moneyClass(stats.avgR)) + '">' + (stats.avgR === null ? "—" : formatNumber(stats.avgR, 2) + "R") + '</strong></div><div style="text-align:right"><small>Trade tertutup</small><strong>' + stats.count + '</strong></div></div>' +
      '</div></section></div>';
    html += '<section class="card trade-table-card"><div class="card-header"><div><h3 class="section-title">Trade terbaru</h3><p class="section-subtitle">Aktivitas jurnal yang paling baru</p></div><button class="button button-secondary" data-page="trades">Lihat semua <span>→</span></button></div>';
    if (!trades.length) {
      html += emptyState("Jurnal kamu dimulai di sini", "Catat trade pertama untuk mulai melihat performa, win rate, dan kurva P/L. Belum ada data contoh yang dicampurkan ke jurnal.", "＋ Catat trade pertama");
    } else {
      html += '<div class="table-scroll"><table><thead><tr><th>Instrumen</th><th>Tanggal</th><th>Arah</th><th>Hasil</th><th>P/L bersih</th><th>R-multiple</th><th>Aksi</th></tr></thead><tbody>' + allSorted.slice(0, 5).map(tradeRow).join("") + '</tbody></table></div>';
      html += '<div class="table-footer"><span>Menampilkan ' + Math.min(5, allSorted.length) + ' dari ' + trades.length + ' trade</span><span>Hanya trade tertutup masuk ke metrik P/L</span></div>';
    }
    html += '</section>';
    content.innerHTML = html;
  }

  function renderEquityChart() {
    const list = closedSortedAscending();
    if (!list.length) {
      return '<div class="chart-empty"><span class="empty-icon">⌁</span><strong>Kurva belum tersedia</strong><p>Kurva akan terbentuk saat kamu menambahkan trade tertutup.</p></div>';
    }
    const values = [];
    let cumulative = 0;
    list.forEach(function (trade) {
      cumulative += calcTrade(trade).pnl;
      values.push({ date: trade.date, value: cumulative });
    });
    const width = 760, top = 22, bottom = 173, left = 45, right = 735;
    let min = Math.min(0, ...values.map(function (v) { return v.value; }));
    let max = Math.max(0, ...values.map(function (v) { return v.value; }));
    if (Math.abs(max - min) < 0.000001) { max += 1; min -= 1; }
    const pad = (max - min) * 0.12;
    min -= pad; max += pad;
    const x = function (i) { return left + (values.length === 1 ? 0.5 : i / (values.length - 1)) * (right - left); };
    const y = function (v) { return bottom - ((v - min) / (max - min)) * (bottom - top); };
    const points = values.map(function (v, i) { return x(i).toFixed(2) + "," + y(v.value).toFixed(2); }).join(" ");
    const area = "M " + x(0).toFixed(2) + " " + bottom + " L " + values.map(function (v, i) { return x(i).toFixed(2) + " " + y(v.value).toFixed(2); }).join(" L ") + " L " + x(values.length - 1).toFixed(2) + " " + bottom + " Z";
    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const yy = top + ((bottom - top) * i / 4);
      const val = max - ((max - min) * i / 4);
      grid += '<line x1="' + left + '" y1="' + yy + '" x2="' + right + '" y2="' + yy + '" stroke="#edf1f6" stroke-width="1"/>';
      grid += '<text x="2" y="' + (yy + 3) + '" fill="#a0a9b7" font-size="10">' + escapeHtml(formatMoney(val, true)) + '</text>';
    }
    const labelIndices = Array.from(new Set([0, Math.floor((values.length - 1) / 2), values.length - 1]));
    const labels = labelIndices.map(function (i) {
      return '<text x="' + x(i) + '" y="199" text-anchor="' + (i === 0 ? "start" : i === values.length - 1 ? "end" : "middle") + '" fill="#a0a9b7" font-size="10">' + escapeHtml(formatDate(values[i].date, false)) + '</text>';
    }).join("");
    return '<svg class="equity-svg" viewBox="0 0 ' + width + ' 215" role="img" aria-label="Grafik P/L kumulatif"><defs><linearGradient id="equity-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#1aa879" stop-opacity=".19"/><stop offset="100%" stop-color="#1aa879" stop-opacity="0"/></linearGradient></defs>' + grid +
      '<path d="' + area + '" fill="url(#equity-fill)"/><polyline points="' + points + '" fill="none" stroke="#1aa879" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + x(values.length - 1) + '" cy="' + y(values[values.length - 1].value) + '" r="4" fill="#fff" stroke="#1aa879" stroke-width="2.3"/>' + labels + '</svg>';
  }

  function outcomePill(trade) {
    const calc = calcTrade(trade);
    if (!calc.isClosed) return '<span class="pill amber">Terbuka</span>';
    if (calc.outcome === "Win") return '<span class="pill green">Profit</span>';
    if (calc.outcome === "Loss") return '<span class="pill red">Loss</span>';
    return '<span class="pill gray">Impas</span>';
  }

  function tradeRow(trade) {
    const calc = calcTrade(trade);
    const id = escapeHtml(trade.id);
    return '<tr><td><div class="asset-cell"><span class="asset-avatar">' + escapeHtml(String(trade.symbol || "?").slice(0, 2).toUpperCase()) + '</span><div class="asset-main"><strong>' + escapeHtml(trade.symbol || "Tanpa simbol") + '</strong><small>' + escapeHtml(trade.market) + (trade.strategy ? " · " + escapeHtml(trade.strategy) : "") + '</small></div></div></td>' +
      '<td>' + escapeHtml(formatDate(trade.date, true)) + '</td><td><span class="side-tag ' + (trade.side === "Short" ? "short" : "long") + '">' + escapeHtml(trade.side) + '</span></td><td>' + outcomePill(trade) + '</td>' +
      '<td><strong class="' + (calc.isClosed ? moneyClass(calc.pnl) : "neutral") + '">' + (calc.isClosed && calc.pnl > 0 ? "+" : "") + (calc.isClosed ? escapeHtml(formatMoney(calc.pnl)) : "—") + '</strong></td>' +
      '<td class="' + (calc.rMultiple === null ? "neutral" : moneyClass(calc.rMultiple)) + '">' + (calc.rMultiple === null ? "—" : (calc.rMultiple > 0 ? "+" : "") + formatNumber(calc.rMultiple, 2) + "R") + '</td>' +
      '<td><div class="row-actions"><button class="mini-action" data-action="edit-trade" data-id="' + id + '" aria-label="Edit trade ' + escapeHtml(trade.symbol) + '">Edit</button><button class="mini-action" data-action="delete-trade" data-id="' + id + '" aria-label="Hapus trade ' + escapeHtml(trade.symbol) + '">Hapus</button></div></td></tr>';
  }

  function getFilteredTrades() {
    const query = searchText.trim().toLowerCase();
    return trades.filter(function (trade) {
      const calc = calcTrade(trade);
      const matchesQuery = !query || [trade.symbol, trade.market, trade.strategy, trade.notes, trade.side].join(" ").toLowerCase().includes(query);
      const matchesMarket = marketFilter === "all" || trade.market === marketFilter;
      const matchesOutcome = outcomeFilter === "all" || (outcomeFilter === "Open" ? !calc.isClosed : calc.outcome === outcomeFilter);
      return matchesQuery && matchesMarket && matchesOutcome;
    }).sort(function (a, b) { return b.date.localeCompare(a.date); });
  }

  function renderTradesPage() {
    content.innerHTML = '<div class="page-intro"><div><h2>Semua transaksi</h2><p>Catatan yang rapi membantu kamu mengevaluasi strategi dari data, bukan ingatan.</p></div><button class="button button-primary" data-action="new-trade">＋ Catat Trade</button></div>' +
      '<section class="card trade-table-card"><div class="table-toolbar"><label class="search-field"><span>⌕</span><input class="search-input" id="trade-search" type="search" placeholder="Cari simbol, strategi, catatan..." value="' + escapeHtml(searchText) + '"></label>' +
      '<select class="field-control" style="width:auto;min-width:130px" id="market-filter" aria-label="Filter pasar"><option value="all">Semua pasar</option>' + MARKETS.map(function (market) { return '<option value="' + escapeHtml(market) + '"' + (marketFilter === market ? " selected" : "") + '>' + escapeHtml(market) + '</option>'; }).join("") + '</select>' +
      '<select class="field-control" style="width:auto;min-width:130px" id="outcome-filter" aria-label="Filter hasil"><option value="all">Semua hasil</option><option value="Open"' + (outcomeFilter === "Open" ? " selected" : "") + '>Terbuka</option><option value="Win"' + (outcomeFilter === "Win" ? " selected" : "") + '>Profit</option><option value="Loss"' + (outcomeFilter === "Loss" ? " selected" : "") + '>Loss</option><option value="BE"' + (outcomeFilter === "BE" ? " selected" : "") + '>Impas</option></select>' +
      '<button class="button button-secondary" data-action="export-csv">↓ CSV</button></div>' +
      '<div class="table-scroll" id="trade-list-wrap"></div><div class="table-footer" id="trade-list-footer"></div></section>' +
      '<div class="notice" style="margin-top:15px"><strong>Catatan perhitungan:</strong> hasil otomatis memakai perubahan harga × ukuran posisi × pengali kontrak, dikurangi biaya. Untuk pasar dengan aturan kontrak atau konversi mata uang khusus, cocokkan hasilnya dengan laporan broker atau masukkan hasil bersih manual.</div>';
    updateTradeList();
  }

  function updateTradeList() {
    const wrap = $("#trade-list-wrap");
    const footer = $("#trade-list-footer");
    if (!wrap || !footer) return;
    const list = getFilteredTrades();
    if (!trades.length) {
      wrap.innerHTML = emptyState("Belum ada trade", "Tambahkan transaksi pertama kamu untuk mulai membangun jurnal yang bisa dianalisis.", "＋ Catat trade");
      footer.innerHTML = '<span>0 transaksi</span><span>Data tersimpan lokal</span>';
      return;
    }
    if (!list.length) {
      wrap.innerHTML = '<div class="inline-empty">Tidak ada trade yang cocok dengan pencarian atau filter ini.</div>';
    } else {
      wrap.innerHTML = '<table><thead><tr><th>Instrumen</th><th>Tanggal</th><th>Arah</th><th>Status</th><th>P/L bersih</th><th>R-multiple</th><th>Aksi</th></tr></thead><tbody>' + list.map(tradeRow).join("") + '</tbody></table>';
    }
    footer.innerHTML = '<span>Menampilkan ' + list.length + ' dari ' + trades.length + ' trade</span><span>' + closedTrades().length + ' trade tertutup dihitung pada analisis</span>';
  }

  function renderBars(items, emptyText) {
    if (!items.length) return '<div class="inline-empty">' + emptyText + '</div>';
    const maxAbs = Math.max(1, ...items.map(function (item) { return Math.abs(item.value); }));
    return '<div class="bar-list">' + items.map(function (item) {
      const pct = Math.max(item.value === 0 ? 0 : 2, Math.abs(item.value) / maxAbs * 100);
      const col = item.value > 0.0000001 ? "#1aa879" : item.value < -0.0000001 ? "#d95563" : "#b7c0cd";
      return '<div class="bar-row"><div class="bar-label" title="' + escapeHtml(item.label) + '">' + escapeHtml(item.label) + '</div><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + col + '"></div></div><div class="bar-value ' + moneyClass(item.value) + '">' + escapeHtml(formatMoney(item.value, true)) + '</div></div>';
    }).join("") + '</div>';
  }

  function renderAnalytics() {
    const stats = getStats(trades);
    const monthMap = {};
    stats.closed.forEach(function (trade) {
      const month = trade.date.slice(0, 7);
      monthMap[month] = (monthMap[month] || 0) + calcTrade(trade).pnl;
    });
    const monthKeys = Object.keys(monthMap).sort().slice(-6);
    const monthNames = monthKeys.map(function (key) {
      const d = new Date(key + "-15T12:00:00");
      return { label: new Intl.DateTimeFormat("id-ID", { month: "short", year: "2-digit" }).format(d), value: monthMap[key] };
    });
    const strategyMap = {};
    stats.closed.forEach(function (trade) {
      const key = trade.strategy || "Tanpa strategi";
      if (!strategyMap[key]) strategyMap[key] = { pnl: 0, count: 0, wins: 0 };
      strategyMap[key].pnl += calcTrade(trade).pnl;
      strategyMap[key].count += 1;
      if (calcTrade(trade).pnl > 0.0000001) strategyMap[key].wins += 1;
    });
    const strategies = Object.keys(strategyMap).map(function (key) {
      return { name: key, pnl: strategyMap[key].pnl, count: strategyMap[key].count, winRate: strategyMap[key].wins / strategyMap[key].count * 100 };
    }).sort(function (a, b) { return b.pnl - a.pnl; });
    let html = '<div class="page-intro"><div><h2>Lihat pola, bukan tebakan</h2><p>Statistik berdasarkan trade tertutup yang tersimpan di jurnal ini.</p></div><button class="button button-secondary" data-action="export-csv">↓ Ekspor data</button></div>';
    html += '<div class="metric-grid">' +
      metricCard("Rata-rata R", stats.avgR === null ? "—" : formatNumber(stats.avgR, 2) + "R", "P/L bersih dibanding risiko per trade", "⌁", "blue", stats.avgR === null ? "" : moneyClass(stats.avgR)) +
      metricCard("Gross profit", formatMoney(stats.wins.reduce(function (sum, t) { return sum + calcTrade(t).pnl; }, 0)), stats.wins.length + " trade profit", "↗", "green", "positive") +
      metricCard("Gross loss", formatMoney(Math.abs(stats.losses.reduce(function (sum, t) { return sum + calcTrade(t).pnl; }, 0))), stats.losses.length + " trade loss", "↘", "red", "negative") +
      metricCard("Saldo estimasi", formatMoney(settings.startingBalance + stats.pnl), "Saldo awal + P/L tertutup", "◉", "amber", "") +
      '</div>';
    html += '<div class="dashboard-grid"><section class="card"><div class="card-header"><div><h3 class="section-title">P/L bulanan</h3><p class="section-subtitle">Enam bulan terbaru dengan trade tertutup</p></div></div><div class="card-body">' +
      renderBars(monthNames, "Belum ada data bulanan. Tambahkan trade yang sudah ditutup.") + '</div></section>' +
      '<section class="card"><div class="card-header"><div><h3 class="section-title">Ringkasan statistik</h3><p class="section-subtitle">Kinerja keseluruhan</p></div></div><div class="card-body"><div class="stat-list">' +
      '<div class="stat-item"><span class="label">Total trade tertutup</span><span class="value">' + stats.count + '</span></div>' +
      '<div class="stat-item"><span class="label">Win rate</span><span class="value">' + formatNumber(stats.winRate, 1) + '%</span></div>' +
      '<div class="stat-item"><span class="label">Profit factor</span><span class="value">' + displayProfitFactor(stats.profitFactor) + '</span></div>' +
      '<div class="stat-item"><span class="label">Trade impas</span><span class="value">' + stats.breakeven + '</span></div>' +
      '<div class="stat-item"><span class="label">P/L bersih</span><span class="value ' + moneyClass(stats.pnl) + '">' + formatMoney(stats.pnl) + '</span></div>' +
      '</div></div></section></div>';
    html += '<section class="card trade-table-card"><div class="card-header"><div><h3 class="section-title">Performa berdasarkan strategi</h3><p class="section-subtitle">Bandingkan strategi dari hasil yang sudah dicatat.</p></div></div>';
    if (!strategies.length) {
      html += '<div class="card-body">' + emptyState("Belum cukup data", "Isi nama strategi ketika mencatat trade agar performanya bisa dibandingkan.", "") + '</div>';
    } else {
      html += '<div class="table-scroll"><table style="min-width:560px"><thead><tr><th>Strategi</th><th>Jumlah trade</th><th>Win rate</th><th>P/L bersih</th></tr></thead><tbody>' + strategies.map(function (item) {
        return '<tr><td><strong style="color:#29364d">' + escapeHtml(item.name) + '</strong></td><td>' + item.count + '</td><td>' + formatNumber(item.winRate, 1) + '%</td><td><strong class="' + moneyClass(item.pnl) + '">' + (item.pnl > 0 ? "+" : "") + escapeHtml(formatMoney(item.pnl)) + '</strong></td></tr>';
      }).join("") + '</tbody></table></div>';
    }
    html += '</section>';
    content.innerHTML = html;
  }

  function renderRisk() {
    const pnl = sumPnl(closedTrades());
    const balance = settings.startingBalance + pnl;
    content.innerHTML = '<div class="page-intro"><div><h2>Rencanakan risiko sebelum entry</h2><p>Hitung perkiraan nominal risiko dan ukuran posisi berdasarkan jarak stop-loss.</p></div></div>' +
      '<div class="risk-layout"><section class="card section-card"><div class="section-card-header"><div><h3>Parameter trade</h3><p>Ubah nilai untuk melihat hasil estimasi.</p></div></div>' +
      '<div class="notice" style="margin-bottom:18px">Saldo dasar yang digunakan: <strong>' + escapeHtml(formatMoney(balance)) + '</strong> (saldo awal ditambah P/L trade tertutup).</div>' +
      '<div class="risk-form-grid">' +
      '<div class="form-field"><label class="form-label" for="risk-percent">Risiko per trade (%)</label><input class="field-control" id="risk-percent" data-risk-field type="number" min="0.01" max="100" step="0.1" value="1"><span class="form-help">Persentase dari saldo dasar.</span></div>' +
      '<div class="form-field"><label class="form-label" for="risk-side">Arah posisi</label><select class="field-control" id="risk-side" data-risk-field><option value="Long">Long / Buy</option><option value="Short">Short / Sell</option></select></div>' +
      '<div class="form-field"><label class="form-label" for="risk-entry">Harga entry</label><input class="field-control" id="risk-entry" data-risk-field type="number" min="0" step="any" placeholder="Contoh: 2500"></div>' +
      '<div class="form-field"><label class="form-label" for="risk-stop">Harga stop-loss</label><input class="field-control" id="risk-stop" data-risk-field type="number" min="0" step="any" placeholder="Contoh: 2475"></div>' +
      '<div class="form-field full"><label class="form-label" for="risk-multiplier">Pengali kontrak / nilai per unit</label><input class="field-control" id="risk-multiplier" data-risk-field type="number" min="0.0000001" step="any" value="1"><span class="form-help">Gunakan pengali sesuai spesifikasi aset/broker. Untuk beberapa instrumen, pengali 1 tidak merepresentasikan nilai P/L sebenarnya.</span></div>' +
      '</div></section>' +
      '<section class="risk-result-panel"><p class="eyebrow">RISK PLANNER</p><h3>Ukuran posisi terukur.</h3><p>Angka di bawah adalah estimasi berdasarkan input, bukan jaminan risiko maksimum pada kondisi pasar nyata.</p>' +
      '<div class="risk-number" id="risk-amount-result">' + escapeHtml(formatMoney(balance * 0.01)) + '</div><div class="risk-number-label">Nominal risiko yang direncanakan</div><div class="risk-divider"></div>' +
      '<div class="risk-mini-grid"><div><small>Ukuran posisi estimasi</small><strong id="risk-size-result">Masukkan harga</strong></div><div><small>Jarak stop-loss</small><strong id="risk-distance-result">—</strong></div><div><small>Risiko dari saldo</small><strong id="risk-percent-result">1%</strong></div><div><small>Saldo dasar</small><strong>' + escapeHtml(formatMoney(balance)) + '</strong></div></div>' +
      '<div class="risk-divider"></div><div style="font-size:10px;line-height:1.65;color:#b8c7d7;position:relative;z-index:1">Rumus ukuran: nominal risiko ÷ (|entry − stop-loss| × pengali). Biaya, slippage, konversi mata uang, margin, dan aturan kontrak kompleks belum termasuk.</div></section></div>';
    updateRiskResult();
  }

  function updateRiskResult() {
    const percent = Math.min(100, Math.max(0, numberOrNull($("#risk-percent") && $("#risk-percent").value) || 0));
    const entry = numberOrNull($("#risk-entry") && $("#risk-entry").value);
    const stop = numberOrNull($("#risk-stop") && $("#risk-stop").value);
    const multiplier = numberOrNull($("#risk-multiplier") && $("#risk-multiplier").value) || 0;
    const balance = settings.startingBalance + sumPnl(closedTrades());
    const amount = balance * percent / 100;
    const distance = entry !== null && stop !== null ? Math.abs(entry - stop) : 0;
    const side = $("#risk-side") ? $("#risk-side").value : "Long";
    const directionValid = entry !== null && stop !== null &&
      (side === "Long" ? stop < entry : stop > entry);
    $("#risk-amount-result").textContent = formatMoney(amount);
    $("#risk-percent-result").textContent = formatNumber(percent, 2) + "%";
    $("#risk-distance-result").textContent = distance > 0 ? formatNumber(distance, 6) : "—";
    if (entry !== null && stop !== null && !directionValid) {
      $("#risk-size-result").textContent = side === "Long" ? "Stop harus di bawah entry" : "Stop harus di atas entry";
    } else {
      $("#risk-size-result").textContent = directionValid && distance > 0 && multiplier > 0
        ? formatNumber(amount / (distance * multiplier), 6)
        : "Masukkan harga";
    }
  }

  function renderSettings() {
    content.innerHTML = '<div class="page-intro"><div><h2>Pengaturan jurnal</h2><p>Kelola mata uang, saldo awal, serta backup data transaksi kamu.</p></div></div>' +
      '<div class="settings-layout"><section class="card section-card"><div class="section-card-header"><div><h3>Pengaturan akun jurnal</h3><p>Mengubah saldo awal akan memengaruhi estimasi saldo dan kalkulator risiko.</p></div></div><form id="settings-form">' +
      '<div class="setting-row"><div><strong>Mata uang akun</strong><small>Digunakan saat menampilkan semua P/L. Ubah hanya jika seluruh nominal jurnal memakai mata uang yang sama.</small></div><select class="field-control" id="setting-currency" name="currency">' + CURRENCIES.map(function (currency) { return '<option value="' + currency + '"' + (settings.currency === currency ? " selected" : "") + '>' + currency + '</option>'; }).join("") + '</select></div>' +
      '<div class="setting-row"><div><strong>Saldo awal</strong><small>Saldo dasar sebelum P/L trade yang tercatat.</small></div><input class="field-control" type="number" id="setting-balance" name="startingBalance" min="0" step="any" required value="' + escapeHtml(settings.startingBalance) + '"></div>' +
      '<div style="display:flex;justify-content:flex-end;padding-top:17px"><button class="button button-primary" type="submit">Simpan pengaturan</button></div></form></section>' +
      '<section class="card section-card"><div class="section-card-header"><div><h3>Backup & pemulihan</h3><p>Jaga salinan jurnal agar data aman saat berganti perangkat.</p></div></div>' +
      '<div class="notice success" style="margin-bottom:16px"><strong>' + trades.length + ' trade tersimpan</strong><br>Data berada di localStorage browser ini. Jurnal tidak otomatis sinkron antarperangkat.</div>' +
      '<div class="backup-actions"><button class="button button-primary" data-action="export-json">↓ Backup JSON</button><button class="button button-secondary" data-action="import-json">↑ Pulihkan JSON</button><button class="button button-secondary" data-action="export-csv">↓ Ekspor CSV</button></div>' +
      '<div style="height:18px"></div><div class="notice warning"><strong>Penting:</strong> menghapus data situs atau browser dapat menghapus jurnal ini. Ekspor backup JSON secara berkala dan simpan di tempat aman. Jangan bagikan file backup yang berisi catatan pribadi.</div>' +
      '<div style="height:21px"></div><div class="divider"></div><div style="height:15px"></div><h3 class="section-title" style="color:#c54a58">Zona berisiko</h3><p class="section-subtitle" style="margin-bottom:13px">Menghapus jurnal tidak dapat dibatalkan tanpa backup.</p><button class="button button-danger" data-action="clear-trades">Hapus semua trade</button></section></div>' +
      '<section class="card section-card" style="margin-top:17px"><div class="section-card-header"><div><h3>Tentang penyimpanan</h3><p>Transparansi cara kerja jurnal ini.</p></div></div><div class="notice">Versi ini adalah aplikasi statis yang dapat dipublikasikan melalui GitHub Pages. Tidak ada login atau sinkronisasi server. Simbol, strategi, catatan, dan transaksi disimpan di browser ini saja. Perhitungan P/L adalah alat bantu; cocokkan hasil dengan statement broker, khususnya untuk forex, kontrak berjangka, CFD, biaya funding, dan aset dengan konversi mata uang.</div></section>';
  }

  function field(label, name, type, value, options) {
    const opts = options || {};
    const full = opts.full ? " full" : "";
    const required = opts.required ? ' required' : "";
    const placeholder = opts.placeholder ? ' placeholder="' + escapeHtml(opts.placeholder) + '"' : "";
    const help = opts.help ? '<span class="form-help">' + escapeHtml(opts.help) + '</span>' : "";
    if (type === "select") {
      const optionHtml = opts.options.map(function (option) {
        const selected = String(value == null ? "" : value) === String(option.value) ? " selected" : "";
        return '<option value="' + escapeHtml(option.value) + '"' + selected + '>' + escapeHtml(option.label) + '</option>';
      }).join("");
      return '<div class="form-field' + full + '"><label class="form-label" for="trade-' + name + '">' + label + (required ? ' <span class="field-required">*</span>' : "") + '</label><select class="field-control" id="trade-' + name + '" name="' + name + '"' + required + '>' + optionHtml + '</select>' + help + '</div>';
    }
    if (type === "textarea") {
      return '<div class="form-field' + full + '"><label class="form-label" for="trade-' + name + '">' + label + '</label><textarea class="field-control textarea" id="trade-' + name + '" name="' + name + '"' + placeholder + '>' + escapeHtml(value || "") + '</textarea>' + help + '</div>';
    }
    return '<div class="form-field' + full + '"><label class="form-label" for="trade-' + name + '">' + label + (required ? ' <span class="field-required">*</span>' : "") + '</label><input class="field-control" id="trade-' + name + '" name="' + name + '" type="' + type + '" value="' + escapeHtml(value == null ? "" : value) + '"' + placeholder + required + (type === "number" ? ' step="any"' : "") + '>' + help + '</div>';
  }

  function openTradeModal(id) {
    editingId = id || null;
    const existing = id ? trades.find(function (trade) { return trade.id === id; }) : null;
    const trade = existing || { date: todayISO(), symbol: "", market: "Forex", side: "Long", strategy: "", entry: "", exit: "", stop: "", size: 1, multiplier: 1, fees: 0, riskAmount: "", manualNet: "", notes: "" };
    const marketOptions = MARKETS.map(function (market) { return { value: market, label: market }; });
    const sideOptions = [{ value: "Long", label: "Long / Buy" }, { value: "Short", label: "Short / Sell" }];
    const form = '<form id="trade-form"><div class="form-grid">' +
      field("Tanggal trade", "date", "date", trade.date, { required: true }) +
      field("Instrumen / simbol", "symbol", "text", trade.symbol, { required: true, placeholder: "Contoh: EURUSD, BTCUSDT, BBCA" }) +
      field("Pasar", "market", "select", trade.market, { options: marketOptions }) +
      field("Arah posisi", "side", "select", trade.side, { options: sideOptions }) +
      field("Strategi", "strategy", "text", trade.strategy, { placeholder: "Contoh: Breakout, Pullback" }) +
      field("Harga entry", "entry", "number", trade.entry, { required: true, placeholder: "Harga masuk" }) +
      field("Harga exit", "exit", "number", trade.exit, { placeholder: "Kosongkan jika masih terbuka", help: "Kosongkan untuk menyimpan posisi yang masih terbuka." }) +
      field("Stop-loss", "stop", "number", trade.stop, { placeholder: "Harga stop-loss" }) +
      field("Ukuran posisi (lot / unit)", "size", "number", trade.size, { required: true, help: "Jumlah lot, unit, atau kontrak sesuai pasar." }) +
      field("Pengali kontrak", "multiplier", "number", trade.multiplier, { required: true, help: "Gunakan 1 bila ukuran sudah mewakili unit dasar." }) +
      field("Biaya total", "fees", "number", trade.fees, { help: "Komisi dan biaya yang ingin dikurangkan." }) +
      field("Nominal risiko manual", "riskAmount", "number", trade.riskAmount || "", { help: "Opsional; bila kosong dihitung dari jarak entry ke stop-loss." }) +
      field("Hasil bersih manual (opsional)", "manualNet", "number", trade.manualNet, { help: "Jika diisi, angka ini menggantikan P/L otomatis dan dianggap sudah bersih setelah biaya.", full: true }) +
      field("Catatan trade", "notes", "textarea", trade.notes, { full: true, placeholder: "Alasan entry, kondisi pasar, emosi, kesalahan, dan pelajaran..." }) +
      '</div><div class="notice" style="margin-top:17px">Rumus P/L otomatis: (exit − entry) × ukuran × pengali kontrak × arah, dikurangi biaya. Posisi Short membalik arah perhitungan.</div></form>';
    $("#modal-root").innerHTML = '<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="trade-modal-title"><div class="modal-header"><div><h2 id="trade-modal-title">' + (existing ? "Edit trade" : "Catat trade baru") + '</h2><p>Isi detail agar hasil dan risiko dapat dihitung dengan konsisten.</p></div><button class="icon-button" data-action="close-modal" type="button" aria-label="Tutup">✕</button></div><div class="modal-body">' + form + '</div><div class="modal-footer"><span class="form-help">Field bertanda * wajib diisi.</span><div class="modal-footer-right"><button class="button button-secondary" type="button" data-action="close-modal">Batal</button><button class="button button-primary" type="submit" form="trade-form">Simpan trade</button></div></div></section></div>';
    const first = $("#trade-symbol");
    if (first) first.focus();
  }

  function closeModal() {
    $("#modal-root").innerHTML = "";
    editingId = null;
  }

  function saveTradeFromForm(event) {
    event.preventDefault();
    const form = event.target;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const symbol = String(data.get("symbol") || "").trim();
    const entry = numberOrNull(data.get("entry"));
    const size = numberOrNull(data.get("size"));
    const multiplier = numberOrNull(data.get("multiplier"));
    if (!symbol || entry === null || size === null || size <= 0 || multiplier === null || multiplier <= 0) {
      showToast("Periksa simbol, entry, ukuran posisi, dan pengali kontrak.");
      return;
    }
    const raw = {
      id: editingId || makeId(),
      date: validDate(data.get("date")),
      symbol: symbol,
      market: data.get("market"),
      side: data.get("side"),
      strategy: String(data.get("strategy") || "").trim(),
      entry: entry,
      exit: numberOrNull(data.get("exit")),
      stop: numberOrNull(data.get("stop")),
      size: size,
      multiplier: multiplier,
      fees: Math.max(0, numberOrNull(data.get("fees")) || 0),
      riskAmount: Math.max(0, numberOrNull(data.get("riskAmount")) || 0),
      manualNet: numberOrNull(data.get("manualNet")),
      notes: String(data.get("notes") || "").trim()
    };
    const normalized = normalizeTrade(raw);
    const wasEditing = Boolean(editingId);
    const previousTrades = trades.slice();
    if (editingId) {
      const index = trades.findIndex(function (trade) { return trade.id === editingId; });
      if (index < 0) {
        showToast("Trade yang akan diedit tidak ditemukan. Muat ulang jurnal lalu coba lagi.");
        return;
      }
      trades[index] = normalized;
    } else {
      trades.push(normalized);
    }
    if (!saveData()) {
      trades = previousTrades;
      return;
    }
    closeModal();
    searchText = "";
    marketFilter = "all";
    outcomeFilter = "all";
    renderPage();
    showToast(wasEditing ? "Trade berhasil diperbarui." : "Trade berhasil dicatat.");
  }

  function showToast(message) {
    const root = $("#toast-root");
    if (!root) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = '<span class="toast-mark"></span><span>' + escapeHtml(message) + '</span>';
    root.appendChild(toast);
    window.setTimeout(function () { toast.remove(); }, 3300);
  }

  function downloadFile(filename, data, mime) {
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportJSON() {
    const payload = { version: 1, exportedAt: new Date().toISOString(), settings: settings, trades: trades };
    downloadFile("tradelog-backup-" + todayISO() + ".json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
    showToast("Backup JSON disiapkan.");
  }

  function csvCell(value) {
    const text = value === null || value === undefined ? "" : String(value);
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function exportCSV() {
    const header = ["id", "tanggal", "simbol", "pasar", "arah", "strategi", "entry", "exit", "stop_loss", "ukuran", "pengali_kontrak", "biaya", "risiko", "hasil_bersih_manual", "pnl_bersih", "r_multiple", "status", "catatan"];
    const rows = trades.slice().sort(function (a, b) { return a.date.localeCompare(b.date); }).map(function (trade) {
      const calc = calcTrade(trade);
      const values = [trade.id, trade.date, trade.symbol, trade.market, trade.side, trade.strategy, trade.entry, trade.exit, trade.stop, trade.size, trade.multiplier, trade.fees, trade.riskAmount, trade.manualNet, calc.isClosed ? calc.pnl : "", calc.rMultiple, calc.outcome, trade.notes];
      return values.map(csvCell).join(",");
    });
    downloadFile("tradelog-trades-" + todayISO() + ".csv", "\uFEFF" + [header.map(csvCell).join(",")].concat(rows).join("\r\n"), "text/csv;charset=utf-8");
    showToast("Ekspor CSV disiapkan.");
  }

  function importJSONFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      const previousTrades = trades.slice();
      const previousSettings = { currency: settings.currency, startingBalance: settings.startingBalance };
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        const incoming = Array.isArray(parsed) ? parsed : parsed.trades;
        if (!Array.isArray(incoming)) throw new Error("Format backup tidak memiliki daftar trades.");
        const seen = new Set();
        trades = incoming.map(normalizeTrade).filter(function (trade) {
          if (seen.has(trade.id)) trade.id = makeId();
          seen.add(trade.id);
          return Boolean(trade.symbol);
        });
        if (parsed.settings && typeof parsed.settings === "object") {
          settings.currency = CURRENCIES.indexOf(parsed.settings.currency) >= 0 ? parsed.settings.currency : settings.currency;
          if (numberOrNull(parsed.settings.startingBalance) !== null) settings.startingBalance = Math.max(0, Number(parsed.settings.startingBalance));
        }
        if (!saveData()) {
          trades = previousTrades;
          settings = previousSettings;
          showToast("Pemulihan dibatalkan karena data tidak berhasil disimpan. Data di layar dikembalikan; periksa ruang penyimpanan browser.");
          renderPage();
          return;
        }
        renderPage();
        showToast("Backup berhasil dipulihkan: " + trades.length + " trade.");
      } catch (error) {
        showToast("Backup tidak valid. Pilih file JSON ekspor TradeLog.");
        console.error("TradeLog import error:", error);
      }
      $("#import-file").value = "";
    };
    reader.onerror = function () {
      showToast("File backup tidak dapat dibaca.");
      $("#import-file").value = "";
    };
    reader.readAsText(file);
  }

  document.addEventListener("click", function (event) {
    const pageButton = event.target.closest("[data-page]");
    if (pageButton) {
      currentPage = pageButton.dataset.page;
      renderPage();
      return;
    }
    const pageLink = event.target.closest("[data-page-link]");
    if (pageLink) {
      event.preventDefault();
      currentPage = pageLink.dataset.pageLink;
      renderPage();
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    if (action === "new-trade") openTradeModal(null);
    else if (action === "edit-trade") openTradeModal(actionButton.dataset.id);
    else if (action === "delete-trade") {
      const target = trades.find(function (trade) { return trade.id === actionButton.dataset.id; });
      if (target && window.confirm("Hapus trade " + target.symbol + " tanggal " + target.date + "?")) {
        const previousTrades = trades.slice();
        trades = trades.filter(function (trade) { return trade.id !== target.id; });
        if (!saveData()) {
          trades = previousTrades;
          return;
        }
        renderPage();
        showToast("Trade dihapus dari jurnal.");
      }
    } else if (action === "close-modal") closeModal();
    else if (action === "backdrop-close" && event.target === actionButton) closeModal();
    else if (action === "mt5-connect") saveMT5Config();
    else if (action === "mt5-disconnect") disconnectMT5();
    else if (action === "mt5-refresh") refreshMT5Snapshot();
    else if (action === "mt5-run-analysis") runMT5MarketAnalysis(actionButton);
    else if (action === "export-json") exportJSON();
    else if (action === "export-csv") exportCSV();
    else if (action === "import-json") $("#import-file").click();
    else if (action === "clear-trades") {
      if (trades.length && window.confirm("Yakin hapus SEMUA trade? Tindakan ini tidak bisa dibatalkan tanpa backup JSON.")) {
        const previousTrades = trades.slice();
        trades = [];
        if (!saveData()) {
          trades = previousTrades;
          return;
        }
        renderPage();
        showToast("Semua trade telah dihapus.");
      } else if (!trades.length) {
        showToast("Jurnal sudah kosong.");
      }
    }
  });

  document.addEventListener("submit", function (event) {
    if (event.target.id === "trade-form") saveTradeFromForm(event);
    if (event.target.id === "settings-form") {
      event.preventDefault();
      const currency = $("#setting-currency").value;
      const startingBalance = numberOrNull($("#setting-balance").value);
      if (CURRENCIES.indexOf(currency) < 0 || startingBalance === null || startingBalance < 0) {
        showToast("Periksa mata uang dan saldo awal.");
        return;
      }
      const previousSettings = { currency: settings.currency, startingBalance: settings.startingBalance };
      settings.currency = currency;
      settings.startingBalance = startingBalance;
      if (!saveData()) {
        settings = previousSettings;
        return;
      }
      renderSettings();
      showToast("Pengaturan berhasil disimpan.");
    }
  });

  document.addEventListener("input", function (event) {
    if (event.target.id === "trade-search") {
      searchText = event.target.value;
      updateTradeList();
    }
    if (event.target.hasAttribute("data-risk-field")) updateRiskResult();
  });

  document.addEventListener("change", function (event) {
    if (event.target.id === "market-filter") { marketFilter = event.target.value; updateTradeList(); }
    if (event.target.id === "outcome-filter") { outcomeFilter = event.target.value; updateTradeList(); }
    if (event.target.hasAttribute("data-risk-field")) updateRiskResult();
    if (event.target.id === "mt5-symbol" || event.target.id === "mt5-interval") {
      const symbolSelect = $("#mt5-symbol");
      const intervalSelect = $("#mt5-interval");
      const selectedSymbol = symbolSelect ? symbolSelect.value : "OANDA:XAUUSD";
      const selectedInterval = intervalSelect ? intervalSelect.value : "15";
      const frame = $("#mt5-chart-frame");
      if (frame) frame.src = tradingViewChartUrl(selectedSymbol, selectedInterval);
      mountTradingViewTechnicalAnalysis(selectedSymbol, selectedInterval);
    }
  });

  $("#import-file").addEventListener("change", function (event) { importJSONFile(event.target.files && event.target.files[0]); });
  $("#menu-toggle").addEventListener("click", function () { document.body.classList.toggle("sidebar-open"); });
  $("#sidebar-scrim").addEventListener("click", function () { document.body.classList.remove("sidebar-open"); });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeModal();
      document.body.classList.remove("sidebar-open");
    }
  });

  loadData();
  renderPage();
})();