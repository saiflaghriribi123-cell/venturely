const PAIRS = [
  { base: "BTC", name: "Bitcoin" },
  { base: "ETH", name: "Ethereum" },
  { base: "BNB", name: "BNB" },
  { base: "SOL", name: "Solana" },
  { base: "XRP", name: "XRP" },
  { base: "ADA", name: "Cardano" },
  { base: "DOGE", name: "Dogecoin" },
  { base: "TRX", name: "TRON" },
  { base: "AVAX", name: "Avalanche" },
  { base: "LINK", name: "Chainlink" },
  { base: "DOT", name: "Polkadot" },
  { base: "LTC", name: "Litecoin" }
];
const SYMBOLS = PAIRS.map((p) => p.base + "USDT");

const DEMO_PRICES = {
  BTC: 110000, ETH: 4000, BNB: 1100, SOL: 190, XRP: 2.6, ADA: 0.65,
  DOGE: 0.2, TRX: 0.3, AVAX: 30, LINK: 18, DOT: 4, LTC: 100
};

const $ = (id) => document.getElementById(id);
const rowsEl = $("rows");
const emptyEl = $("empty");
const modal = $("modal");

const data = {};
PAIRS.forEach((p) => {
  const sym = p.base + "USDT";
  data[sym] = { sym, base: p.base, name: p.name, price: 0, change: 0, high: 0, low: 0, vol: 0, series: [] };
});

let tab = "all";
let query = "";
let rows = {};
let wsOpen = false;
let demoMode = false;
let currentModal = null;
let currentInterval = "1h";

/* ---------- Favorites (localStorage) ---------- */
let favs = new Set();
try {
  favs = new Set(JSON.parse(localStorage.getItem("venturely-favs") || "[]"));
} catch (e) { /* ignore */ }

function saveFavs() {
  try {
    localStorage.setItem("venturely-favs", JSON.stringify([...favs]));
  } catch (e) { /* ignore */ }
}

/* ---------- Formatting ---------- */
function fmtPrice(p) {
  if (!p) return "—";
  const d = p >= 100 ? 2 : p >= 1 ? 3 : 5;
  return p.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtPct(v) {
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}
function fmtVol(v) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);
}

function sparkSVG(series, up, withArea) {
  if (!series || series.length < 2) return "";
  const w = 200, h = 60;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const pts = series.map((v, i) => {
    const x = (i / (series.length - 1)) * w;
    const y = h - 4 - ((v - min) / range) * (h - 8);
    return x.toFixed(1) + "," + y.toFixed(1);
  });
  const color = up ? "#0ecb81" : "#f6465d";
  const area = withArea
    ? `<polygon points="0,${h} ${pts.join(" ")} ${w},${h}" fill="${color}" opacity="0.15"/>`
    : "";
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${area}<polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

/* ---------- Status ---------- */
function setStatus(text, cls) {
  $("status").className = "status " + (cls || "");
  $("status-text").textContent = text;
}

/* ---------- Table ---------- */
function getList() {
  const q = query.trim().toLowerCase();
  let list = Object.values(data).filter((d) =>
    !q || (d.base + " " + d.name).toLowerCase().includes(q)
  );
  if (tab === "favs") list = list.filter((d) => favs.has(d.sym));

  if (tab === "gainers") list.sort((a, b) => b.change - a.change);
  else if (tab === "losers") list.sort((a, b) => a.change - b.change);
  else list.sort((a, b) => b.vol - a.vol);
  return list;
}

function renderRows() {
  const list = getList();
  rowsEl.innerHTML = "";
  rows = {};

  list.forEach((d) => {
    const tr = document.createElement("tr");

    const tdStar = document.createElement("td");
    const star = document.createElement("button");
    star.type = "button";
    star.className = "star" + (favs.has(d.sym) ? " on" : "");
    star.textContent = favs.has(d.sym) ? "★" : "☆";
    star.setAttribute("aria-label", "Toggle favorite " + d.base);
    star.addEventListener("click", (e) => {
      e.stopPropagation();
      if (favs.has(d.sym)) favs.delete(d.sym); else favs.add(d.sym);
      saveFavs();
      if (tab === "favs") renderRows();
      else {
        star.classList.toggle("on", favs.has(d.sym));
        star.textContent = favs.has(d.sym) ? "★" : "☆";
      }
    });
    tdStar.appendChild(star);

    const tdPair = document.createElement("td");
    tdPair.className = "pair";
    tdPair.innerHTML = `<strong></strong><small>/USDT</small><span class="nm"></span>`;
    tdPair.querySelector("strong").textContent = d.base;
    tdPair.querySelector(".nm").textContent = d.name;

    const tdPrice = document.createElement("td");
    tdPrice.className = "r price-cell";
    const tdChange = document.createElement("td");
    tdChange.className = "r";
    const pill = document.createElement("span");
    tdChange.appendChild(pill);
    const tdHigh = document.createElement("td");
    tdHigh.className = "r hide-m";
    const tdLow = document.createElement("td");
    tdLow.className = "r hide-m";
    const tdVol = document.createElement("td");
    tdVol.className = "r hide-m";
    const tdSpark = document.createElement("td");
    tdSpark.className = "hide-s";
    const spark = document.createElement("div");
    spark.className = "spark";
    tdSpark.appendChild(spark);

    tr.append(tdStar, tdPair, tdPrice, tdChange, tdHigh, tdLow, tdVol, tdSpark);
    tr.addEventListener("click", () => openModal(d.sym));
    rowsEl.appendChild(tr);

    rows[d.sym] = { tr, price: tdPrice, pill, high: tdHigh, low: tdLow, vol: tdVol, spark };
    updateRow(d.sym, null);
  });

  emptyEl.hidden = list.length > 0;
}

function updateRow(sym, dir) {
  const r = rows[sym];
  if (!r) return;
  const d = data[sym];
  const up = d.change >= 0;

  r.price.textContent = fmtPrice(d.price);
  r.price.className = "r price-cell " + (dir === "up" ? "up" : dir === "down" ? "down" : "");
  if (dir) {
    r.price.classList.add(dir === "up" ? "flash-up" : "flash-down");
    setTimeout(() => {
      r.price.classList.remove("up", "down", "flash-up", "flash-down");
    }, 900);
  }

  r.pill.textContent = fmtPct(d.change);
  r.pill.className = "pill " + (up ? "up" : "down");
  r.high.textContent = fmtPrice(d.high);
  r.low.textContent = fmtPrice(d.low);
  r.vol.textContent = fmtVol(d.vol);
}

function drawSparks() {
  Object.keys(rows).forEach((sym) => {
    const d = data[sym];
    rows[sym].spark.innerHTML = sparkSVG(d.series, d.change >= 0, false);
  });
}

/* ---------- Top cards ---------- */
function setStat(valId, chgId, price, change) {
  $(valId).textContent = price;
  const c = $(chgId);
  if (change === null) return;
  c.textContent = fmtPct(change);
  c.className = change >= 0 ? "up" : "down";
}

function updateStats() {
  const list = Object.values(data).filter((d) => d.price > 0);
  if (!list.length) return;

  const btc = data.BTCUSDT, eth = data.ETHUSDT;
  setStat("s-btc", "s-btc-c", "$" + fmtPrice(btc.price), btc.change);
  setStat("s-eth", "s-eth-c", "$" + fmtPrice(eth.price), eth.change);

  const gain = [...list].sort((a, b) => b.change - a.change)[0];
  setStat("s-gain", "s-gain-c", gain.base + " $" + fmtPrice(gain.price), gain.change);

  const vol = [...list].sort((a, b) => b.vol - a.vol)[0];
  $("s-vol").textContent = vol.base + "/USDT";
  $("s-vol-c").textContent = "$" + fmtVol(vol.vol);
}

/* ---------- Tick handler ---------- */
function onTick(sym, price, change, high, low, vol) {
  const d = data[sym];
  if (!d) return;
  const dir = price > d.price ? "up" : price < d.price ? "down" : null;

  d.price = price;
  d.change = change;
  d.high = high;
  d.low = low;
  d.vol = vol;
  if (d.series.length) d.series[d.series.length - 1] = price;

  updateRow(sym, d.price ? dir : null);

  if (currentModal === sym) updateModalPrice();
}

/* ---------- Binance REST ---------- */
async function fetchTickers() {
  const url =
    "https://api.binance.com/api/v3/ticker/24hr?symbols=" +
    encodeURIComponent(JSON.stringify(SYMBOLS));
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function fetchKlines(sym, interval, limit) {
  const url =
    "https://api.binance.com/api/v3/klines?symbol=" + sym +
    "&interval=" + interval + "&limit=" + limit;
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const arr = await res.json();
  return arr.map((k) => parseFloat(k[4])); // close prices
}

async function loadInitial() {
  const tickers = await fetchTickers();
  tickers.forEach((t) => {
    const d = data[t.symbol];
    if (!d) return;
    d.price = parseFloat(t.lastPrice);
    d.change = parseFloat(t.priceChangePercent);
    d.high = parseFloat(t.highPrice);
    d.low = parseFloat(t.lowPrice);
    d.vol = parseFloat(t.quoteVolume);
  });

  await Promise.all(SYMBOLS.map(async (s) => {
    try {
      data[s].series = await fetchKlines(s, "1h", 24);
    } catch (e) {
      data[s].series = [data[s].price, data[s].price];
    }
  }));
}

async function pollREST() {
  if (wsOpen || demoMode) return;
  try {
    const tickers = await fetchTickers();
    tickers.forEach((t) => {
      onTick(t.symbol, parseFloat(t.lastPrice), parseFloat(t.priceChangePercent),
        parseFloat(t.highPrice), parseFloat(t.lowPrice), parseFloat(t.quoteVolume));
    });
    setStatus("LIVE (polling)", "live");
  } catch (e) {
    setStatus("Reconnecting…", "warn");
  }
}

/* ---------- Binance WebSocket ---------- */
function connectWS() {
  const streams = SYMBOLS.map((s) => s.toLowerCase() + "@ticker").join("/");
  const ws = new WebSocket("wss://stream.binance.com:9443/stream?streams=" + streams);

  ws.onopen = () => {
    wsOpen = true;
    setStatus("LIVE", "live");
  };

  ws.onmessage = (ev) => {
    try {
      const t = JSON.parse(ev.data).data;
      onTick(t.s, parseFloat(t.c), parseFloat(t.P), parseFloat(t.h), parseFloat(t.l), parseFloat(t.q));
    } catch (e) { /* ignore bad message */ }
  };

  ws.onclose = () => {
    wsOpen = false;
    if (!demoMode) {
      setStatus("Reconnecting…", "warn");
      setTimeout(connectWS, 3000);
    }
  };

  ws.onerror = () => ws.close();
}

/* ---------- Demo mode (if Binance is unreachable) ---------- */
function startDemo() {
  demoMode = true;
  setStatus("DEMO mode (Binance unreachable)", "warn");

  Object.values(data).forEach((d) => {
    const p = DEMO_PRICES[d.base];
    const series = [p];
    for (let i = 1; i < 24; i++) series.unshift(series[0] * (1 + (Math.random() - 0.5) * 0.03));
    d.series = series;
    d.price = p;
    d.change = (p / series[0] - 1) * 100;
    d.high = p * 1.03;
    d.low = p * 0.97;
    d.vol = Math.random() * 900e6 + 50e6;
  });

  renderRows();
  drawSparks();
  updateStats();

  setInterval(() => {
    Object.values(data).forEach((d) => {
      if (Math.random() < 0.6) {
        const np = d.price * (1 + (Math.random() - 0.5) * 0.004);
        const change = d.change + (np / d.price - 1) * 100;
        onTick(d.sym, np, change, Math.max(d.high, np), Math.min(d.low, np), d.vol);
      }
    });
  }, 1200);
}

/* ---------- Modal ---------- */
function updateModalPrice() {
  const d = data[currentModal];
  $("m-price").textContent = "$" + fmtPrice(d.price);
  const c = $("m-change");
  c.textContent = fmtPct(d.change) + " (24h)";
  c.className = d.change >= 0 ? "up" : "down";
}

async function loadModalChart() {
  const d = data[currentModal];
  let series;
  try {
    series = await fetchKlines(d.sym, currentInterval, 60);
  } catch (e) {
    series = d.series;
  }
  if (!currentModal) return;

  const up = series[series.length - 1] >= series[0];
  $("m-chart").innerHTML = sparkSVG(series, up, true);

  const stats = $("m-stats");
  stats.innerHTML = "";
  [["High", Math.max(...series)], ["Low", Math.min(...series)], ["Open", series[0]]].forEach(([label, val]) => {
    const box = document.createElement("div");
    const s = document.createElement("small");
    s.textContent = label + " (" + currentInterval + ")";
    const b = document.createElement("b");
    b.textContent = "$" + fmtPrice(val);
    box.append(s, b);
    stats.appendChild(box);
  });
}

function openModal(sym) {
  const d = data[sym];
  currentModal = sym;
  currentInterval = "1h";
  document.querySelectorAll("#intervals button").forEach((b) =>
    b.classList.toggle("active", b.dataset.int === "1h")
  );

  $("m-pair").textContent = d.base + "/USDT";
  $("m-title").textContent = d.name;
  $("m-chart").innerHTML = "";
  updateModalPrice();
  modal.showModal();
  loadModalChart();
}

document.querySelectorAll("#intervals button").forEach((b) => {
  b.addEventListener("click", () => {
    currentInterval = b.dataset.int;
    document.querySelectorAll("#intervals button").forEach((x) => x.classList.toggle("active", x === b));
    loadModalChart();
  });
});

$("m-close").addEventListener("click", () => modal.close());
modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.close();
});
modal.addEventListener("close", () => { currentModal = null; });

/* ---------- Events ---------- */
document.querySelectorAll("#tabs .tab").forEach((b) => {
  b.addEventListener("click", () => {
    tab = b.dataset.tab;
    document.querySelectorAll("#tabs .tab").forEach((x) => x.classList.toggle("active", x === b));
    renderRows();
    drawSparks();
  });
});

$("search").addEventListener("input", (e) => {
  query = e.target.value;
  renderRows();
  drawSparks();
});

/* ---------- Start ---------- */
async function init() {
  setStatus("Connecting…", "warn");
  try {
    await loadInitial();
    renderRows();
    drawSparks();
    updateStats();
    connectWS();

    setInterval(() => { drawSparks(); updateStats(); }, 2000);
    setInterval(() => { if (tab === "gainers" || tab === "losers") { renderRows(); drawSparks(); } }, 10000);
    setInterval(pollREST, 5000);
  } catch (e) {
    console.error("Binance error:", e);
    startDemo();
    setInterval(() => { drawSparks(); updateStats(); }, 2000);
  }
}

init();