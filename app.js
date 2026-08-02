/* Tankboard · TankPuls
   Static GitHub-Pages-ready dashboard.
*/

const API_BASE = "https://api.tankpuls.de/v1";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const STORAGE_KEY = "tankboard.v1";
const DEFAULT_STATE = {
  plz: "10559",
  fuel: "E10",
  radius: 5,
  sort: "price",
  openOnly: false,
  selectedStationId: null,
  selectedRange: "24h",
  favorites: [],
  center: { lat: 52.5208, lon: 13.3736 },
  favoritesOnly: false,
  autoRefresh: true,
  refreshMs: 45000,
};

const SIGNAL_ORDER = { low: 0, avg: 1, high: 2, xhigh: 3, unknown: 4 };
const SIGNAL_LABEL = { low: "Günstig", avg: "Durchschnitt", high: "Teuer", xhigh: "Sehr teuer", unknown: "—" };
const SIGNAL_CLASS = { low: "low", avg: "avg", high: "high", xhigh: "xhigh", unknown: "avg" };
const FUEL_LABEL = { E5: "E5", E10: "E10", Diesel: "Diesel" };
const PRESETS = [
  { plz: "10559", label: "Berlin" },
  { plz: "20095", label: "Hamburg" },
  { plz: "80331", label: "München" },
  { plz: "50667", label: "Köln" },
  { plz: "60311", label: "Frankfurt" },
  { plz: "70173", label: "Stuttgart" },
];

const els = {};
let state = loadState();
let map;
let markersLayer;
let historyChart;
let currentStations = [];
let currentRegionSummary = null;
let currentStation = null;
let geoCache = new Map();
let refreshTimer = null;
let latestRequestToken = 0;

boot();

function boot() {
  captureEls();
  renderStatic();
  bindEvents();
  initMap();
  hydrateFromUrl();
  loadInitialData();
  maybeStartAutoRefresh();
}

function captureEls() {
  for (const id of [
    "apiStatus", "locationTitle", "germanyAvg", "germanyHint", "selectedPrice", "selectedMeta", "regionMedian",
    "regionSpread", "regionUpdated", "plzInput", "fuelSelect", "radiusInput", "radiusOutput", "sortSelect",
    "openOnly", "searchForm", "presets", "legend", "map", "stationName", "stationAddress", "stationSignal",
    "stationOpen", "stationDistance", "btnFavorite", "btnMaps", "btnCopy", "historyTabs", "historyChart",
    "historyHint", "stationTable", "btnExportCsv", "btnRefresh", "btnRefreshList", "btnGeo", "autoRefresh",
    "rateInfo", "btnSortByPrice", "btnSortByDistance", "btnFavoritesOnly", "footerSource"
  ]) {
    els[id] = document.getElementById(id);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return { ...DEFAULT_STATE, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    plz: state.plz,
    fuel: state.fuel,
    radius: state.radius,
    sort: state.sort,
    openOnly: state.openOnly,
    selectedStationId: state.selectedStationId,
    selectedRange: state.selectedRange,
    favorites: state.favorites,
    center: state.center,
    favoritesOnly: state.favoritesOnly,
    autoRefresh: state.autoRefresh,
    refreshMs: state.refreshMs,
  }));
}

function bindEvents() {
  els.searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    state.plz = normalizePlz(els.plzInput.value) || state.plz;
    state.fuel = els.fuelSelect.value;
    state.radius = Number(els.radiusInput.value);
    state.sort = els.sortSelect.value;
    state.openOnly = els.openOnly.checked;
    await loadInitialData();
  });

  els.radiusInput.addEventListener("input", () => {
    els.radiusOutput.value = `${els.radiusInput.value} km`;
  });

  els.btnRefresh.addEventListener("click", () => loadInitialData(true));
  els.btnRefreshList.addEventListener("click", () => loadInitialData(true));
  els.btnGeo.addEventListener("click", useBrowserLocation);
  els.autoRefresh.checked = state.autoRefresh;
  els.autoRefresh.addEventListener("change", () => {
    state.autoRefresh = els.autoRefresh.checked;
    saveState();
    maybeStartAutoRefresh();
  });
  els.btnExportCsv.addEventListener("click", exportCsv);
  els.btnFavorite.addEventListener("click", toggleFavoriteCurrent);
  els.btnMaps.addEventListener("click", openInMaps);
  els.btnCopy.addEventListener("click", copyStationLink);
  els.btnSortByPrice.addEventListener("click", () => setSortQuick("price"));
  els.btnSortByDistance.addEventListener("click", () => setSortQuick("distance"));
  els.btnFavoritesOnly.addEventListener("click", () => {
    state.favoritesOnly = !state.favoritesOnly;
    els.btnFavoritesOnly.classList.toggle("active", state.favoritesOnly);
    renderStations();
    syncUrl();
  });

  for (const btn of els.historyTabs.querySelectorAll("button")) {
    btn.addEventListener("click", async () => {
      for (const el of els.historyTabs.querySelectorAll("button")) el.classList.remove("active");
      btn.classList.add("active");
      state.selectedRange = btn.dataset.range;
      saveState();
      if (currentStation) await loadHistory(currentStation.id, state.selectedRange, state.fuel);
    });
  }

  els.presets.addEventListener("click", async (e) => {
    const btn = e.target.closest(".preset-chip");
    if (!btn) return;
    state.plz = btn.dataset.plz;
    els.plzInput.value = state.plz;
    await loadInitialData();
  });
}

function initMap() {
  map = L.map("map", { zoomControl: true, preferCanvas: true }).setView([state.center.lat, state.center.lon], 12);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
  map.on("moveend", () => {
    const c = map.getCenter();
    state.center = { lat: round(c.lat, 5), lon: round(c.lng, 5) };
    saveState();
  });
}

function renderStatic() {
  els.plzInput.value = state.plz;
  els.fuelSelect.value = state.fuel;
  els.radiusInput.value = state.radius;
  els.radiusOutput.value = `${state.radius} km`;
  els.sortSelect.value = state.sort;
  els.openOnly.checked = state.openOnly;
  els.autoRefresh.checked = state.autoRefresh;
  els.footerSource.textContent = "Quelle: TankPuls · MTS-K";
  els.btnFavoritesOnly.classList.toggle("active", state.favoritesOnly);

  els.presets.innerHTML = PRESETS.map((p) => `<button class="preset-chip" type="button" data-plz="${p.plz}">${p.plz} ${p.label}</button>`).join("");
  els.legend.innerHTML = [
    ["low", "unter Median"],
    ["avg", "im Normalbereich"],
    ["high", "über Median"],
    ["xhigh", "deutlich teurer"],
  ].map(([key, label]) => `<span class="legend-item"><span class="legend-swatch signal-${key}"></span>${label}</span>`).join("");
}

function hydrateFromUrl() {
  const params = new URLSearchParams(location.search);
  const plz = normalizePlz(params.get("plz"));
  const fuel = params.get("fuel");
  const range = params.get("range");
  const stationId = params.get("station");
  const sort = params.get("sort");
  if (plz) state.plz = plz;
  if (fuel && FUEL_LABEL[fuel]) state.fuel = fuel;
  if (range && ["24h", "7d", "30d", "90d", "1y"].includes(range)) state.selectedRange = range;
  if (sort && ["price", "distance", "brand", "updated"].includes(sort)) state.sort = sort;
  if (stationId) state.selectedStationId = stationId;
  saveState();
}

function syncUrl() {
  const params = new URLSearchParams();
  if (state.plz) params.set("plz", state.plz);
  if (state.fuel) params.set("fuel", state.fuel);
  if (state.selectedRange) params.set("range", state.selectedRange);
  if (state.sort) params.set("sort", state.sort);
  if (state.selectedStationId) params.set("station", state.selectedStationId);
  const next = `${location.pathname}${params.toString() ? `?${params.toString()}` : ""}${location.hash}`;
  history.replaceState({}, "", next);
}

async function loadInitialData(force = false, centerOverride = null) {
  const token = ++latestRequestToken;
  setLoading(true);
  try {
    const center = centerOverride || await resolvePlz(state.plz);
    if (token !== latestRequestToken) return;
    if (center) {
      state.center = center;
      map.setView([center.lat, center.lon], Math.max(map.getZoom(), 12), { animate: true });
    }
    syncControls();
    await Promise.allSettled([
      loadHealth(),
      loadRegionSummary(state.plz, state.fuel),
      loadStations(center, force),
    ]);
    if (state.selectedStationId) {
      const existing = currentStations.find((s) => s.id === state.selectedStationId);
      if (existing) await selectStation(existing, { skipMapFly: true });
    } else if (currentStations.length) {
      await selectStation(currentStations[0], { skipMapFly: true });
    }
  } catch (err) {
    reportError(err);
  } finally {
    if (token === latestRequestToken) setLoading(false);
  }
}

function syncControls() {
  els.plzInput.value = state.plz;
  els.fuelSelect.value = state.fuel;
  els.radiusInput.value = state.radius;
  els.radiusOutput.value = `${state.radius} km`;
  els.sortSelect.value = state.sort;
  els.openOnly.checked = state.openOnly;
  els.autoRefresh.checked = state.autoRefresh;
  els.btnFavoritesOnly.classList.toggle("active", state.favoritesOnly);
  els.locationTitle.textContent = `${state.plz} · ${state.fuel}`;
}

function setLoading(isLoading) {
  const status = isLoading ? "Lädt…" : "Live";
  els.apiStatus.textContent = status;
  els.apiStatus.style.background = isLoading ? "rgba(89,216,255,0.12)" : "rgba(84,224,152,0.14)";
}

async function loadHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`, { headers: { Accept: "application/json" } });
    const data = await res.json();
    const latency = data?.latency_ms ?? data?.latency ?? null;
    const last = data?.last_message_at || data?.last_message || data?.updated_at || null;
    els.apiStatus.textContent = res.ok ? `Online${latency ? ` · ${latency} ms` : ""}` : `API ${res.status}`;
    els.rateInfo.textContent = `Rate-Limit: ${headerRateHint(res)}`;
    if (last) els.footerSource.textContent = `Quelle: TankPuls · MTS-K · Letztes Signal: ${formatDateTime(last)}`;
  } catch {
    els.apiStatus.textContent = "Offline / Netzwerk";
  }
}

async function loadRegionSummary(plz, fuel) {
  try {
    const res = await fetch(`${API_BASE}/regions/${encodeURIComponent(plz)}/summary?fuel=${encodeURIComponent(fuel)}`, { headers: { Accept: "application/json" } });
    const data = await res.json();
    currentRegionSummary = data;
    const median = getRegionMedian(data);
    const spread = getRegionSpread(data);
    const updatedAt = data?.updated_at || data?.updatedAt || data?.last_updated || null;
    els.regionMedian.textContent = formatPrice(median);
    els.regionSpread.textContent = spread != null ? `${formatPrice(spread, 3)}€` : "—";
    els.regionUpdated.textContent = updatedAt ? formatRelativeTime(updatedAt) : "—";
    els.germanyAvg.textContent = formatPrice(median);
    els.germanyHint.textContent = "TankPuls dokumentiert einen offiziellen Median je PLZ-Region; diese Kachel nutzt den regionalen Vergleichswert.";
    return data;
  } catch (err) {
    currentRegionSummary = null;
    els.regionMedian.textContent = "—";
    els.regionSpread.textContent = "—";
    els.regionUpdated.textContent = "—";
    els.germanyAvg.textContent = "—";
    els.germanyHint.textContent = "Regionale Preisdaten konnten nicht geladen werden.";
    throw err;
  }
}

async function loadStations(center, force = false) {
  const url = new URL(`${API_BASE}/stations`);
  url.searchParams.set("lat", center?.lat ?? state.center.lat);
  url.searchParams.set("lon", center?.lon ?? state.center.lon);
  url.searchParams.set("radius", state.radius);
  url.searchParams.set("fuel", state.fuel);
  url.searchParams.set("sort", state.sort);
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  const data = await res.json();
  const stations = normalizeStations(data);
  currentStations = applyLocalFilters(stations);
  currentStations = sortStations(currentStations, state.sort);
  renderStations();
  renderMarkers();
  els.locationTitle.textContent = `${state.plz} · ${state.fuel} · ${currentStations.length} Stationen`;
  syncUrl();
  if (res.ok) {
    const updated = data?.updated_at || data?.updatedAt || null;
    if (updated) els.rateInfo.textContent = `${headerRateHint(res)} · Stand ${formatDateTime(updated)}`;
  }
  return data;
}

async function selectStation(station, opts = {}) {
  currentStation = station;
  state.selectedStationId = station.id;
  saveState();
  syncUrl();
  els.stationName.textContent = station.brand || station.name || "Station";
  els.stationAddress.textContent = station.address || station.location || "Adresse nicht angegeben.";
  els.stationSignal.textContent = `${SIGNAL_LABEL[normalizeSignal(station.signal)]} · ${normalizeSignal(station.signal)}`;
  els.stationSignal.className = `signal-badge ${signalClass(normalizeSignal(station.signal))}`;
  els.stationOpen.textContent = station.open === false ? "Geschlossen" : "Offen";
  els.stationDistance.textContent = station.distance != null ? `${round(station.distance, 1)} km` : "Distanz —";
  els.selectedMeta.textContent = `${station.brand || "Station"} · ${station.address || ""}`.trim();
  const price = currentPriceForFuel(station, state.fuel);
  els.selectedPrice.textContent = formatPrice(price);
  els.btnFavorite.textContent = isFavorite(station.id) ? "★ Favorit" : "☆ Favorit";
  els.btnMaps.dataset.lat = station.lat ?? station.latitude ?? state.center.lat;
  els.btnMaps.dataset.lon = station.lon ?? station.longitude ?? state.center.lon;
  els.btnCopy.dataset.station = station.id;
  if (!opts.skipMapFly) {
    const coords = stationCoords(station);
    if (coords) map.flyTo(coords, Math.max(map.getZoom(), 15), { duration: 0.6 });
  }
  await loadHistory(station.id, state.selectedRange, state.fuel);
  renderStations();
  renderMarkers();
}

async function loadHistory(id, range, fuel) {
  try {
    const res = await fetch(`${API_BASE}/stations/${encodeURIComponent(id)}/history?range=${encodeURIComponent(range)}&fuel=${encodeURIComponent(fuel)}`, { headers: { Accept: "application/json" } });
    const data = await res.json();
    const series = normalizeHistory(data);
    if (!series.length) {
      els.historyHint.textContent = "Kein Verlauf verfügbar.";
      return;
    }
    renderHistory(series, range);
    const first = series[0].value;
    const last = series[series.length - 1].value;
    const diff = last - first;
    els.historyHint.textContent = `${series.length} Punkte · ${diff >= 0 ? "+" : ""}${formatPrice(diff, 3)} seit Start des Zeitraums`;
  } catch {
    els.historyHint.textContent = "Verlauf konnte nicht geladen werden.";
  }
}

function renderHistory(series, range) {
  const ctx = els.historyChart.getContext("2d");
  if (historyChart) historyChart.destroy();
  historyChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: series.map((p) => p.label),
      datasets: [{
        label: `Preis ${range}`,
        data: series.map((p) => p.value),
        borderWidth: 2,
        tension: 0.28,
        pointRadius: 0,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${formatPrice(ctx.parsed.y)} €` } } },
      scales: {
        x: { grid: { color: "rgba(180,214,255,0.08)" }, ticks: { color: "#91a7c3", maxTicksLimit: 6 } },
        y: { grid: { color: "rgba(180,214,255,0.08)" }, ticks: { color: "#91a7c3", callback: (v) => `${Number(v).toFixed(2)} €` } },
      },
    },
  });
}

function renderStations() {
  const rows = currentStations.filter((s) => !state.favoritesOnly || isFavorite(s.id));
  if (!rows.length) {
    els.stationTable.innerHTML = `<tr><td colspan="4" class="muted">Keine Stationen im aktuellen Filter.</td></tr>`;
    return;
  }

  els.stationTable.innerHTML = rows.map((station) => {
    const price = currentPriceForFuel(station, state.fuel);
    const sig = normalizeSignal(station.signal);
    const fav = isFavorite(station.id) ? "<span class='favorite'>★</span>" : "";
    return `<tr data-id="${station.id}" class="${station.id === state.selectedStationId ? "selected" : ""}">
      <td>
        <div class="station-name">${fav}${escapeHtml(station.brand || station.name || "Station")}</div>
        <div class="muted small">${escapeHtml(station.address || "")}</div>
      </td>
      <td><span class="price-chip ${sig}">${formatPrice(price)}</span></td>
      <td>${station.distance != null ? `${round(station.distance, 1)} km` : "—"}</td>
      <td><span class="signal-badge ${signalClass(sig)}">${normalizeSignalLabel(sig)}${station.open === false ? " · geschlossen" : " · offen"}</span></td>
    </tr>`;
  }).join("");

  for (const row of els.stationTable.querySelectorAll("tr[data-id]")) {
    row.addEventListener("click", async () => {
      const s = currentStations.find((x) => x.id === row.dataset.id);
      if (s) await selectStation(s);
    });
  }
}

function renderMarkers() {
  markersLayer.clearLayers();
  const selectedId = state.selectedStationId;
  currentStations.forEach((station) => {
    const coords = stationCoords(station);
    if (!coords) return;
    const price = currentPriceForFuel(station, state.fuel);
    const sig = normalizeSignal(station.signal);
    const marker = L.circleMarker(coords, {
      radius: station.id === selectedId ? 11 : 8,
      weight: 2,
      color: "#08131f",
      fillColor: signalColor(sig),
      fillOpacity: 0.9,
    });
    marker.bindPopup(`
      <div class="popup-title">${escapeHtml(station.brand || station.name || "Station")}</div>
      <div>${escapeHtml(station.address || "")}</div>
      <div class="popup-price ${sig}">${formatPrice(price)} €</div>
    `);
    marker.on("click", () => selectStation(station));
    marker.addTo(markersLayer);
  });
}

function applyLocalFilters(stations) {
  let rows = [...stations];
  if (state.openOnly) rows = rows.filter((s) => s.open !== false);
  return rows;
}

function sortStations(stations, sort) {
  const rows = [...stations];
  rows.sort((a, b) => {
    if (sort === "distance") return (a.distance ?? 1e9) - (b.distance ?? 1e9);
    if (sort === "brand") return (a.brand || "").localeCompare(b.brand || "", "de");
    if (sort === "updated") return dateValue(b.reported_at || b.updated_at) - dateValue(a.reported_at || a.updated_at);
    return priceValue(a, state.fuel) - priceValue(b, state.fuel) || (a.distance ?? 1e9) - (b.distance ?? 1e9);
  });
  return rows;
}

function setSortQuick(value) {
  state.sort = value;
  els.sortSelect.value = value;
  saveState();
  currentStations = sortStations(currentStations, value);
  renderStations();
  syncUrl();
}

function toggleFavoriteCurrent() {
  if (!currentStation) return;
  const id = currentStation.id;
  const next = new Set(state.favorites);
  if (next.has(id)) next.delete(id); else next.add(id);
  state.favorites = [...next];
  saveState();
  els.btnFavorite.textContent = isFavorite(id) ? "★ Favorit" : "☆ Favorit";
  renderStations();
}

function isFavorite(id) {
  return state.favorites.includes(id);
}

function openInMaps() {
  if (!currentStation) return;
  const coords = stationCoords(currentStation);
  const q = encodeURIComponent(`${currentStation.brand || currentStation.name || "Tankstelle"} ${currentStation.address || ""}`.trim());
  const url = coords
    ? `https://www.google.com/maps/search/?api=1&query=${coords[0]},${coords[1]}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

async function copyStationLink() {
  if (!currentStation) return;
  const url = new URL(location.href);
  url.searchParams.set("station", currentStation.id);
  try {
    await navigator.clipboard.writeText(url.toString());
    els.btnCopy.textContent = "Kopiert";
    setTimeout(() => (els.btnCopy.textContent = "Link kopieren"), 1200);
  } catch {
    alert(url.toString());
  }
}

function exportCsv() {
  const rows = currentStations.map((s) => ({
    brand: s.brand || s.name || "",
    address: s.address || "",
    price: currentPriceForFuel(s, state.fuel),
    distance_km: s.distance ?? "",
    signal: normalizeSignal(s.signal),
    open: s.open ?? "",
    reported_at: s.reported_at || s.updated_at || "",
  }));
  const headers = Object.keys(rows[0] || { brand: "", address: "" });
  const csv = [headers.join(";")].concat(rows.map((r) => headers.map((h) => csvCell(r[h])).join(";"))).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tankpuls_${state.plz}_${state.fuel}.csv`;
  a.click();
}

function maybeStartAutoRefresh() {
  clearInterval(refreshTimer);
  if (!state.autoRefresh) return;
  refreshTimer = setInterval(() => loadInitialData(true), state.refreshMs);
}

async function useBrowserLocation() {
  if (!navigator.geolocation) return reportError(new Error("Geolocation nicht verfügbar"));
  navigator.geolocation.getCurrentPosition(async (pos) => {
    state.center = { lat: round(pos.coords.latitude, 5), lon: round(pos.coords.longitude, 5) };
    state.plz = await reverseLookupPlz(state.center.lat, state.center.lon) || state.plz;
    await loadInitialData(true, state.center);
  }, (err) => reportError(err), { enableHighAccuracy: true, timeout: 9000, maximumAge: 300000 });
}

async function resolvePlz(plz) {
  if (!plz) return null;
  if (geoCache.has(plz)) return geoCache.get(plz);
  const url = new URL(NOMINATIM);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "de");
  url.searchParams.set("postalcode", plz);
  url.searchParams.set("city", "Deutschland");
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;
  const first = data[0];
  const center = { lat: Number(first.lat), lon: Number(first.lon) };
  geoCache.set(plz, center);
  return center;
}

async function reverseLookupPlz(lat, lon) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  try {
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    const data = await res.json();
    return data?.address?.postcode ? normalizePlz(data.address.postcode) : null;
  } catch {
    return null;
  }
}

function normalizeStations(data) {
  const stations = Array.isArray(data?.stations) ? data.stations : Array.isArray(data) ? data : [];
  return stations.map((s) => ({
    ...s,
    id: s.id || s.station_id || s.stationId,
    brand: s.brand || s.name || s.title,
    address: s.address || s.location?.address || s.location || s.street,
    distance: asNum(s.distance),
    open: s.open ?? s.is_open ?? s.open_now,
    signal: normalizeSignal(s.signal),
    reported_at: s.reported_at || s.updated_at || s.reportedAt,
    lat: asNum(s.lat ?? s.latitude ?? s.location?.lat),
    lon: asNum(s.lon ?? s.lng ?? s.longitude ?? s.location?.lon ?? s.location?.lng),
    prices: s.prices || s.price || {},
  }));
}

function normalizeHistory(data) {
  const raw = Array.isArray(data?.points) ? data.points : Array.isArray(data?.history) ? data.history : Array.isArray(data) ? data : [];
  return raw.map((p, idx) => {
    const ts = p.ts || p.time || p.timestamp || p.at || p.date || idx;
    const val = asNum(p.price ?? p.value ?? p.amount ?? p.y);
    return { label: historyLabel(ts), value: val, ts };
  }).filter((p) => Number.isFinite(p.value));
}

function currentPriceForFuel(station, fuel) {
  const prices = station.prices || {};
  const direct = prices[fuel.toLowerCase()] ?? prices[fuel] ?? station.price;
  return asNum(direct);
}

function priceValue(station, fuel) {
  const v = currentPriceForFuel(station, fuel);
  return Number.isFinite(v) ? v : 1e9;
}

function signalColor(signal) {
  return { low: "#5df2a1", avg: "#f7d774", high: "#ff9966", xhigh: "#ff6b88" }[signal] || "#91a7c3";
}

function normalizeSignal(signal) {
  const s = String(signal || "").toLowerCase();
  return ["low", "avg", "high", "xhigh"].includes(s) ? s : "unknown";
}

function signalClass(signal) {
  return `signal-${SIGNAL_CLASS[normalizeSignal(signal)]}`;
}

function normalizeSignalLabel(signal) {
  return SIGNAL_LABEL[normalizeSignal(signal)] || "—";
}

function stationCoords(station) {
  const lat = asNum(station.lat ?? station.latitude ?? station.location?.lat);
  const lon = asNum(station.lon ?? station.lng ?? station.longitude ?? station.location?.lon ?? station.location?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
  return null;
}

function getRegionMedian(data) {
  return asNum(data?.region?.median ?? data?.median ?? data?.summary?.median ?? data?.price_median ?? data?.avg);
}

function getRegionSpread(data) {
  const spread = data?.spread ?? data?.range ?? data?.region?.spread;
  if (Number.isFinite(asNum(spread))) return asNum(spread);
  const min = asNum(data?.min ?? data?.region?.min);
  const max = asNum(data?.max ?? data?.region?.max);
  if (Number.isFinite(min) && Number.isFinite(max)) return max - min;
  return null;
}

function headerRateHint(res) {
  const remaining = res.headers.get("X-RateLimit-Remaining") || "—";
  const reset = res.headers.get("X-RateLimit-Reset") || null;
  return reset ? `${remaining} verbleibend · Reset ${reset}` : `${remaining} verbleibend`;
}

function reportError(err) {
  console.error(err);
  els.apiStatus.textContent = "Fehler beim Laden";
  els.apiStatus.style.background = "rgba(255,107,136,0.16)";
}

function csvCell(value) {
  const str = String(value ?? "");
  return `"${str.replaceAll('"', '""')}"`;
}

function formatPrice(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)} €`;
}

function round(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return value;
  const m = 10 ** digits;
  return Math.round(Number(value) * m) / m;
}

function asNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function normalizePlz(plz) {
  const digits = String(plz || "").replace(/\D/g, "").slice(0, 5);
  return digits.length === 5 ? digits : "";
}

function formatDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(d);
}

function formatRelativeTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `vor ${mins} Min.`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  return `vor ${days} Tg.`;
}

function dateValue(v) { return new Date(v || 0).getTime() || 0; }

function historyLabel(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[ch]));
}

// expose for debugging in GitHub Pages console
window.__tankboard = { state, loadInitialData };
