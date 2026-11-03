const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");

const TODAY = "2026-11-04";

async function addTrade(page, trade) {
  await page.locator('[data-action="new-trade"]').first().click();
  await page.locator("#trade-date").fill(trade.date || TODAY);
  await page.locator("#trade-symbol").fill(trade.symbol);
  await page.locator("#trade-market").selectOption(trade.market || "Forex");
  await page.locator("#trade-side").selectOption(trade.side || "Long");
  await page.locator("#trade-strategy").fill(trade.strategy || "Test strategy");
  await page.locator("#trade-entry").fill(String(trade.entry));
  if (trade.exit !== undefined && trade.exit !== null) {
    await page.locator("#trade-exit").fill(String(trade.exit));
  }
  await page.locator("#trade-stop").fill(trade.stop == null ? "" : String(trade.stop));
  await page.locator("#trade-size").fill(String(trade.size == null ? 1 : trade.size));
  await page.locator("#trade-multiplier").fill(String(trade.multiplier == null ? 1 : trade.multiplier));
  await page.locator("#trade-fees").fill(String(trade.fees == null ? 0 : trade.fees));
  if (trade.manualNet !== undefined && trade.manualNet !== null) {
    await page.locator("#trade-manualNet").fill(String(trade.manualNet));
  }
  if (trade.notes) await page.locator("#trade-notes").fill(trade.notes);
  if (trade.checklist) {
    for (const [key, checked] of Object.entries(trade.checklist)) {
      if (checked) await page.locator('input[name="checklist_' + key + '"]').check();
    }
  }
  await page.locator('button[form="trade-form"][type="submit"]').click();
  await expect(page.locator("#modal-root")).toBeEmpty();
}

function yahooPayload(interval, count = 100) {
  const seconds = ({ "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "60m": 3600, "1d": 86400, "1wk": 604800 })[interval] || 900;
  const now = Math.floor(Date.now() / 1000);
  const lastClosedStart = Math.floor(now / seconds) * seconds - seconds;
  const timestamp = [];
  const open = [], high = [], low = [], close = [], volume = [];
  for (let i = 0; i < count; i++) {
    const t = lastClosedStart - (count - 1 - i) * seconds;
    const base = 2300 + i * 0.15 + Math.sin(i / 5) * 1.5;
    timestamp.push(t);
    open.push(base - 0.2);
    high.push(base + 1.1);
    low.push(base - 1.0);
    close.push(base + 0.25);
    volume.push(1000 + i);
  }
  return {
    chart: {
      result: [{
        meta: { symbol: "GC=F" },
        timestamp,
        indicators: { quote: [{ open, high, low, close, volume }] }
      }],
      error: null
    }
  };
}

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("https://fonts.gstatic.com/**", route => route.abort());
  await page.route("https://s3.tradingview.com/**", route => route.abort());
  await page.route("https://s.tradingview.com/**", route => route.abort());
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
});

test("all primary sections open and render", async ({ page }) => {
  const sections = [
    ["trades", "Semua transaksi"],
    ["analytics", "Lihat pola"],
    ["risk", "Rencanakan risiko"],
    ["mt5", "Akun MetaTrader 5"],
    ["settings", "Pengaturan jurnal"]
  ];
  for (const [key, heading] of sections) {
    const selector = key === "settings" ? '.sidebar-bottom [data-page="settings"]' : '.nav-list [data-page="' + key + '"]';
    await page.locator(selector).click();
    await expect(page.locator("#page-title")).not.toBeEmpty();
    await expect(page.locator("#page-content")).toContainText(heading);
  }
  await page.locator('.nav-list [data-page="mt5journal"]').click();
  await expect(page.locator("#page-title")).toHaveText("Jurnal Transaksi MT5");
  await expect(page.locator("#mt5-journal-root")).toBeVisible();
});

test("trade create, calculation, edit, delete and persistence work", async ({ page }) => {
  await addTrade(page, {
    symbol: "EURUSD",
    market: "Forex",
    side: "Long",
    entry: 1,
    exit: 1.1,
    size: 1,
    multiplier: 100000,
    fees: 5,
    checklist: { setupValid: true, stopPlanned: true }
  });
  await expect(page.locator("#page-content")).toContainText("EURUSD");
  await expect(page.locator(".metric-card").first()).toContainText("9.995");

  await page.locator('[data-action="edit-trade"]').first().click();
  await expect(page.locator('input[name="checklist_setupValid"]')).toBeChecked();
  await expect(page.locator('input[name="checklist_stopPlanned"]')).toBeChecked();
  await page.locator("#trade-strategy").fill("London breakout");
  await page.locator('button[form="trade-form"][type="submit"]').click();
  await expect(page.locator("#page-content")).toContainText("London breakout");

  await page.reload();
  await expect(page.locator("#page-content")).toContainText("EURUSD");

  page.once("dialog", dialog => dialog.accept());
  await page.locator('[data-action="delete-trade"]').first().click();
  await expect(page.locator("#page-content")).toContainText("Jurnal kamu dimulai di sini");
});

test("trade search and market/outcome filters work", async ({ page }) => {
  await addTrade(page, { symbol: "EURUSD", market: "Forex", entry: 1, exit: 1.1, multiplier: 100, size: 1 });
  await addTrade(page, { symbol: "BTCUSDT", market: "Crypto", entry: 100, exit: 90, multiplier: 1, size: 1, side: "Long" });
  await page.locator('.nav-list [data-page="trades"]').click();
  await page.locator("#trade-search").fill("BTC");
  await expect(page.locator("#trade-list-wrap")).toContainText("BTCUSDT");
  await expect(page.locator("#trade-list-wrap")).not.toContainText("EURUSD");
  await page.locator("#trade-search").fill("");
  await page.locator("#market-filter").selectOption("Crypto");
  await page.locator("#outcome-filter").selectOption("Loss");
  await expect(page.locator("#trade-list-wrap")).toContainText("BTCUSDT");
  await expect(page.locator("#trade-list-wrap")).not.toContainText("EURUSD");
});

test("open positions remain open and manual net P/L overrides the automatic result", async ({ page }) => {
  await addTrade(page, { symbol: "USDCHF", market: "Forex", entry: 0.9, size: 1, multiplier: 100 });
  await page.locator(".nav-list [data-page=\"trades\"]").click();
  await page.locator("#outcome-filter").selectOption("Open");
  await expect(page.locator("#trade-list-wrap")).toContainText("USDCHF");
  await expect(page.locator("#trade-list-wrap")).toContainText("Terbuka");

  await addTrade(page, { symbol: "AUDUSD", market: "Forex", entry: 0.65, exit: 0.66, size: 1, multiplier: 100, fees: 10, manualNet: 7 });
  await expect(page.locator("#page-content")).toContainText("AUDUSD");
  await expect(page.locator("#page-content")).toContainText("7");
});

test("daily risk guardrail flags a breached loss limit", async ({ page }) => {
  const today = await page.evaluate(() => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  });
  await addTrade(page, { date: today, symbol: "XAUUSD", market: "Komoditas", entry: 100, exit: 90, size: 40, multiplier: 1 });
  await page.locator(".nav-list [data-page=\"risk\"]").click();
  await expect(page.locator(".daily-risk-card")).toContainText("Batas disiplin harian tercapai");
  await expect(page.locator(".daily-risk-card")).toContainText("tidak menghentikan order di broker");
});

test("risk calculator validates direction and calculates position size", async ({ page }) => {
  await page.locator('.nav-list [data-page="risk"]').click();
  await page.locator("#risk-entry").fill("100");
  await page.locator("#risk-stop").fill("95");
  await page.locator("#risk-multiplier").fill("1");
  await expect(page.locator("#risk-amount-result")).toContainText("100");
  await expect(page.locator("#risk-size-result")).toHaveText("20");
  await page.locator("#risk-side").selectOption("Short");
  await expect(page.locator("#risk-size-result")).toContainText("Entry harus positif; stop di atas entry");
});

test("failed storage write rolls back both journal keys without losing old trades", async ({ page }) => {
  const today = await page.evaluate(() => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  });
  const oldTrade = {
    id: "old-preserved-trade",
    date: today,
    symbol: "OLDPAIR",
    market: "Forex",
    side: "Long",
    entry: 1,
    exit: 1.1,
    size: 1,
    multiplier: 1,
    fees: 0
  };
  await page.evaluate(({ trade }) => {
    localStorage.setItem("tradelog.trades.v1", JSON.stringify([trade]));
    localStorage.setItem("tradelog.settings.v1", JSON.stringify({
      currency: "USD",
      startingBalance: 10000,
      dailyLossLimitPercent: 3,
      maxTradesPerDay: 5
    }));
  }, { trade: oldTrade });
  await page.reload();
  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    let failOnce = true;
    Storage.prototype.setItem = function (key, value) {
      if (key === "tradelog.settings.v1" && failOnce) {
        failOnce = false;
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    };
  });

  await page.locator('[data-action="new-trade"]').first().click();
  await page.locator("#trade-date").fill(today);
  await page.locator("#trade-symbol").fill("NEWPAIR");
  await page.locator("#trade-entry").fill("1");
  await page.locator("#trade-exit").fill("1.2");
  await page.locator("#trade-size").fill("1");
  await page.locator("#trade-multiplier").fill("1");
  await page.locator('button[form="trade-form"][type="submit"]').click();

  await expect(page.locator("#toast-root")).toContainText("Perubahan dibatalkan");
  await expect(page.locator("#modal-root")).not.toBeEmpty();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("tradelog.trades.v1")));
  expect(stored).toHaveLength(1);
  expect(stored[0].symbol).toBe("OLDPAIR");

  await page.reload();
  await expect(page.locator("#page-content")).toContainText("OLDPAIR");
  await expect(page.locator("#page-content")).not.toContainText("NEWPAIR");
});

test("settings persist after reload", async ({ page }) => {
  await page.locator('.sidebar-bottom [data-page="settings"]').click();
  await page.locator("#setting-currency").selectOption("IDR");
  await page.locator("#setting-balance").fill("2500000");
  await page.locator("#setting-daily-loss-limit").fill("2");
  await page.locator("#setting-max-trades-day").fill("3");
  await page.locator("#settings-form button[type='submit']").click();
  await expect(page.locator("#toast-root")).toContainText("berhasil disimpan");
  await page.reload();
  await page.locator('.sidebar-bottom [data-page="settings"]').click();
  await expect(page.locator("#setting-currency")).toHaveValue("IDR");
  await expect(page.locator("#setting-balance")).toHaveValue("2500000");
  await expect(page.locator("#setting-daily-loss-limit")).toHaveValue("2");
  await expect(page.locator("#setting-max-trades-day")).toHaveValue("3");
});

test("JSON backup export and restore preserve trade data", async ({ page }) => {
  await addTrade(page, { symbol: "GBPUSD", market: "Forex", entry: 1.2, exit: 1.25, size: 1, multiplier: 100, checklist: { setupValid: true, newsChecked: true } });
  await page.locator('.sidebar-bottom [data-page="settings"]').click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator('[data-action="export-json"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/tradelog-backup-.*\.json$/);
  const backupBuffer = await fs.readFile(await download.path());
  const backup = JSON.parse(backupBuffer.toString("utf8"));
  expect(backup.trades[0].symbol).toBe("GBPUSD");
  expect(backup.trades[0].checklist.setupValid).toBe(true);
  expect(backup.trades[0].checklist.newsChecked).toBe(true);

  page.once("dialog", dialog => dialog.accept());
  await page.locator('[data-action="clear-trades"]').click();
  await expect(page.locator("#page-content")).toContainText("0 trade tersimpan");
  await page.locator('[data-action="import-json"]').click();
  await page.locator("#import-file").setInputFiles({
    name: download.suggestedFilename(),
    mimeType: "application/json",
    buffer: backupBuffer
  });
  await expect(page.locator("#toast-root")).toContainText("Backup berhasil dipulihkan");
  await page.locator('.nav-list [data-page="trades"]').click();
  await expect(page.locator("#page-content")).toContainText("GBPUSD");
});

test("CSV export produces a downloadable trade report", async ({ page }) => {
  await addTrade(page, { symbol: "USDJPY", market: "Forex", entry: 150, exit: 151, size: 1, multiplier: 10, checklist: { setupValid: true, riskWithinLimit: true } });
  const downloadPromise = page.waitForEvent("download");
  await page.locator('[data-action="export-csv"]').first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/tradelog-trades-.*\.csv$/);
  const csv = await fs.readFile(await download.path(), "utf8");
  expect(csv).toContain("checklist_setup_valid");
  expect(csv).toContain("checklist_risk_within_limit");
  expect(csv).toContain("true");
});

test("MT5 HTML import shows closed deals and entry activity", async ({ page }) => {
  await page.locator('.nav-list [data-page="mt5journal"]').click();
  page.on("dialog", dialog => dialog.accept());
  const html = `<!doctype html><html><body>
    <h2>Deals</h2>
    <table>
      <tr><th>Time</th><th>Deal</th><th>Symbol</th><th>Type</th><th>Direction</th><th>Volume</th><th>Price</th><th>Commission</th><th>Swap</th><th>Profit</th><th>Comment</th></tr>
      <tr><td>2026.11.04 09:00:00</td><td>1001</td><td>EURUSD</td><td>buy</td><td>in</td><td>0.10</td><td>1.1000</td><td>-0.5</td><td>0</td><td>0</td><td>open deal</td></tr>
      <tr><td>2026.11.04 10:00:00</td><td>1002</td><td>EURUSD</td><td>sell</td><td>out</td><td>0.10</td><td>1.1050</td><td>-0.5</td><td>0</td><td>5.0</td><td>close deal</td></tr>
    </table>
  </body></html>`;
  await page.locator("#mt5-journal-file").setInputFiles({
    name: "mt5-report.html",
    mimeType: "text/html",
    buffer: Buffer.from(html)
  });
  await expect(page.locator("#mt5j-import-count")).toContainText("2 baris");
  await expect(page.locator("#mt5j-tabs")).toContainText("Deal / tertutup");
  await page.locator('[data-mt5j-tab="entry"]').click();
  await expect(page.locator("#mt5j-table")).toContainText("open deal");
  await page.locator('[data-mt5j-tab="closed"]').click();
  await expect(page.locator("#mt5j-table")).toContainText("close deal");
});

test("MT5 chart selector changes chart and analysis timeframe", async ({ page }) => {
  await page.locator('.nav-list [data-page="mt5"]').click();
  await page.locator("#mt5-symbol").selectOption("FX:EURUSD");
  await expect(page.locator("#mt5-chart-frame")).toHaveAttribute("src", /FX%3AEURUSD/);
  await expect(page.locator("#mt5-analysis-label")).toContainText("FX:EURUSD");
  await page.locator("#mt5-interval").selectOption("240");
  await expect(page.locator("#mt5-analysis-label")).toContainText("H4");
});

test("market analysis uses closed candles and aggregates H4 from H1", async ({ page }) => {
  await page.route("https://query1.finance.yahoo.com/**", async route => {
    const url = new URL(route.request().url());
    const interval = url.searchParams.get("interval") || "15m";
    const count = interval === "60m" ? 220 : 100;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(yahooPayload(interval, count))
    });
  });
  await page.locator('.nav-list [data-page="mt5"]').click();
  await page.locator("#mt5-run-analysis").click();
  await expect(page.locator("#mt5-analysis-result")).toContainText("Harga candle terakhir (GC=F)");
  await page.locator("#mt5-interval").selectOption("240");
  await page.locator("#mt5-run-analysis").click();
  await expect(page.locator("#mt5-analysis-result")).toContainText("H4 (agregasi H1)");
});

test("multi-timeframe prompt builder returns grounded candle data", async ({ page }) => {
  await page.route("https://query1.finance.yahoo.com/**", async route => {
    const url = new URL(route.request().url());
    const interval = url.searchParams.get("interval") || "15m";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(yahooPayload(interval, 240))
    });
  });
  await page.locator('.nav-list [data-page="mt5"]').click();
  await page.locator("#mt5-generate-prompt").click();
  await expect(page.locator("#mt5-prompt-status")).toContainText("Prompt multi-timeframe berhasil dibuat", { timeout: 30000 });
  await expect(page.locator("#mt5-prompt-output")).toHaveValue(/KONFIRMASI SELURUH TIMEFRAME/, { timeout: 5000 });
  await expect(page.locator("#mt5-prompt-output")).toHaveValue(/GC=F/);
  await expect(page.locator("#mt5-copy-prompt")).toBeEnabled();
});

test("MT5 bridge connects to a valid read-only snapshot and displays positions", async ({ page }) => {
  const origin = "http://127.0.0.1:4173";
  await page.route("http://127.0.0.1:8765/**", async route => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Headers": "authorization, accept, content-type",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Vary": "Origin"
        }
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": origin, "Vary": "Origin" },
      body: JSON.stringify({
        connected: true,
        timestamp: "2026-11-04T10:00:00+00:00",
        account: {
          login: "123456",
          server: "Demo-Server",
          currency: "USD",
          balance: 1000,
          equity: 1005,
          profit: 5,
          freeMargin: 900,
          leverage: 100
        },
        positions: [{
          ticket: 1,
          symbol: "EURUSD",
          type: "BUY",
          volume: 0.1,
          priceOpen: 1.1,
          priceCurrent: 1.105,
          sl: 1.09,
          tp: 1.12,
          profit: 5,
          swap: -0.2
        }]
      })
    });
  });
  await page.locator('.nav-list [data-page="mt5"]').click();
  await page.locator("#mt5-endpoint").fill("http://127.0.0.1:8765/api/mt5/snapshot");
  await page.locator("#mt5-api-key").fill("test-read-only-key");
  await page.locator('[data-action="mt5-connect"]').click();
  await expect(page.locator("#mt5-status-pill")).toHaveText("TERHUBUNG");
  await expect(page.locator("#mt5-account-panel")).toContainText("Demo-Server");
  await expect(page.locator("#mt5-positions-list")).toContainText("EURUSD");
  await expect(page.locator("#mt5-positions-list")).toContainText("1.09");
  await expect(page.locator("#mt5-positions-list")).toContainText("1.12");
  await expect(page.locator("#mt5-positions-list")).toContainText("4,8");
});

test("mobile navigation opens and closes without leaving the overlay stuck", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#menu-toggle").click();
  await expect(page.locator("body")).toHaveClass(/sidebar-open/);
  await page.locator("#sidebar-scrim").click({ position: { x: 380, y: 400 } });
  await expect(page.locator("body")).not.toHaveClass(/sidebar-open/);
});
