// 연도별 세계사 지도 v4 — 순수 정적(읽기 전용) / 콘텐츠는 git의 content/*.md 로 관리
// 데이터: content/manifest.json (빌드 산출물) + data/borders/*.geojson(경량) + data/basemap/*
// 기능: 지형(Natural Earth) + 시대별 국경 + 지점/경로/영역 사건(+경로 애니메이션) + 2단계 타임라인

const BASE_DIR = "data/basemap/";
const BORDERS_DIR = "data/borders/";
const MANIFEST_URL = "content/manifest.json";

const REGION_COLORS = {
  "유럽": "#6ea8fe", "남미": "#74d99f", "동아시아": "#ff9e6b",
  "서아시아": "#c79bff", "아프리카": "#ffd56b", "북미": "#ff8fb1",
};
const DEFAULT_REGION_COLOR = "#9aa6c4";
const GLOBAL_STEP = 10;
const GEO_LABEL = { point: "지점", route: "경로", area: "영역" };

const state = {
  eras: [], years: [], events: [], scenes: [],
  mode: "global", scene: null, year: 1490, globalYear: 1490,
  borderCache: new Map(), baseCache: new Map(),
  currentBorderGeoLayer: null, currentBorderFilename: null,
  baseLevel: null, playTimer: null, anim: null,
};

const $ = (s) => document.querySelector(s);
const slider = $("#year-slider");
const md = (s) => (window.marked ? window.marked.parse(s || "") : escapeHtml(s || ""));

// ─── 지도
const map = L.map("map", { worldCopyJump: true, minZoom: 2, maxZoom: 8, center: [25, 15], zoom: 2 });
map.createPane("basePane").style.zIndex = 200;
map.createPane("borderPane").style.zIndex = 300;
map.createPane("eventPane").style.zIndex = 450;
// 성능: 수천 폴리곤을 DOM(SVG) 대신 캔버스에 그린다 → 팬/줌이 매끄러움
const baseRenderer = L.canvas({ pane: "basePane", padding: 0.4 });
const borderRenderer = L.canvas({ pane: "borderPane", padding: 0.4 });
map.attributionControl.setPrefix(false);
map.attributionControl.addAttribution('경계 historical-basemaps · 지형 Natural Earth');
const baseLayer = L.layerGroup().addTo(map);
const borderLayer = L.layerGroup().addTo(map);
const eventLayer = L.layerGroup().addTo(map);
const animLayer = L.layerGroup().addTo(map);

// ─── 유틸
const yearText = (y) => (y < 0 ? `기원전 ${Math.abs(y)}년` : `서기 ${y}년`);
const yearShort = (y) => (y < 0 ? `BC${Math.abs(y)}` : `${y}`);
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
async function fetchJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} (${r.status})`); return r.json(); }
function showLoading(msg) { const el = $("#loading"); el.hidden = !msg; if (msg) el.textContent = msg; }

// ─── 매니페스트
async function loadManifest() { return fetchJSON(MANIFEST_URL); }
function applyManifest(man) {
  state.eras = (man.eras || []).slice().sort((a, b) => a.year - b.year);
  state.years = state.eras.map((e) => ({ year: e.year, filename: e.borderFile, label: e.label || "" }));
  state.events = (man.events || []).map(normalizeEvent);
  state.scenes = man.scenes || [];
}

// ─── 사건 정규화
function normalizeEvent(raw) {
  const start = raw.start ?? raw.year ?? 0;
  const end = (raw.end === "" || raw.end === undefined) ? (raw.endYear ?? null) : raw.end;
  const type = raw.geometry || "point";
  let geom;
  if (type === "route") {
    const latlngs = raw.waypoints?.length ? raw.waypoints.map((w) => [w.lat, w.lng]) : (raw.coordinates || []).map(([lng, lat]) => [lat, lng]);
    geom = { type: "route", latlngs, waypoints: raw.waypoints || null };
  } else if (type === "area") {
    geom = { type: "area", rings: (raw.coordinates || []).map((ring) => ring.map(([lng, lat]) => [lat, lng])) };
  } else {
    geom = { type: "point", latlng: raw.coordinates ? [raw.coordinates[1], raw.coordinates[0]] : [raw.lat, raw.lng] };
  }
  return { id: raw.id, title: raw.title || "(제목 없음)", region: raw.region || "기타", category: raw.category || "",
    start, end, animate: !!raw.animate, body: raw.body || "", sceneId: raw.sceneId || null, geom };
}
function repLatLng(ev) {
  if (ev.geom.type === "point") return ev.geom.latlng;
  if (ev.geom.type === "route") return ev.geom.latlngs[0];
  return ev.geom.rings[0]?.[0];
}

// ─── 배경 지형
async function loadBase(name) { if (state.baseCache.has(name)) return state.baseCache.get(name); const g = await fetchJSON(BASE_DIR + name); state.baseCache.set(name, g); return g; }
async function ensureBase(level) {
  if (state.baseLevel === level) return; state.baseLevel = level;
  const p = level === "50m" ? ["ne_50m_land.json", "ne_50m_lakes.json", "ne_50m_rivers_lake_centerlines.json"]
    : ["ne_110m_land.json", "ne_110m_lakes.json", "ne_110m_rivers_lake_centerlines.json"];
  const [land, lakes, rivers] = await Promise.all(p.map(loadBase));
  const opt = { pane: "basePane", interactive: false, renderer: baseRenderer, smoothFactor: 2 };
  baseLayer.clearLayers();
  baseLayer.addLayer(L.geoJSON(land, { ...opt, style: { color: "#2c3e5e", weight: 0.6, fillColor: "#20304a", fillOpacity: 1 } }));
  baseLayer.addLayer(L.geoJSON(lakes, { ...opt, style: { color: "#16263e", weight: 0.4, fillColor: "#0c1a2e", fillOpacity: 1 } }));
  baseLayer.addLayer(L.geoJSON(rivers, { ...opt, style: { color: "#3a5274", weight: 0.7 } }));
}
map.on("zoomend", () => ensureBase(map.getZoom() >= 5 ? "50m" : "110m"));

// ─── 국경
function nearestBorder(year) { return state.years.reduce((b, y) => Math.abs(y.year - year) < Math.abs(b.year - year) ? y : b, state.years[0]); }
function precisionOf(p) { const n = parseInt(p.BORDERPRECISION, 10); return Number.isFinite(n) ? n : 2; }
function colorForSubject(s) { s = (s || "").trim(); if (!s) return "#3a4566"; let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return `hsl(${h}, 52%, 56%)`; }
function borderStyle(f) {
  const p = f.properties || {}, prec = precisionOf(p);
  return { color: "#0b1020", weight: prec >= 3 ? 1 : prec === 2 ? 0.8 : 0.6, dashArray: prec >= 3 ? null : prec === 2 ? "3,3" : "1,4",
    fillColor: colorForSubject(p.SUBJECTO || p.NAME), fillOpacity: prec >= 3 ? 0.42 : prec === 2 ? 0.32 : 0.18 };
}
async function loadBorderFile(fn) { if (state.borderCache.has(fn)) return state.borderCache.get(fn); const g = await fetchJSON(BORDERS_DIR + fn); state.borderCache.set(fn, g); return g; }

const builtBorders = new Map(); // filename → 이미 만들어 둔 L.geoJSON (재방문 즉시 표시)
function showBorderLayer(gj, filename) {
  borderLayer.clearLayers(); borderLayer.addLayer(gj);
  state.currentBorderGeoLayer = gj; state.currentBorderFilename = filename;
  $("#legend").hidden = false;
}
// 슬라이더를 빠르게 끌 때 무거운 파일을 연속 파싱하지 않도록 경계 로딩을 디바운스
let borderTimer = null, pendingBorderYear = null;
function scheduleBorders(year) {
  const snap = state.years.length ? nearestBorder(year) : null;
  const badge = $("#border-badge");
  if (snap) { badge.hidden = false; badge.innerHTML = `경계 기준: <strong>${yearText(snap.year)}</strong>` + (snap.year !== year ? ` <span class="muted">(가장 가까운 시대 지도)</span>` : ""); }
  if (!snap || state.currentBorderFilename === snap.filename) return;
  if (builtBorders.has(snap.filename)) { showBorderLayer(builtBorders.get(snap.filename), snap.filename); return; }
  pendingBorderYear = year;
  clearTimeout(borderTimer);
  borderTimer = setTimeout(() => renderBorders(pendingBorderYear), 110);
}
async function renderBorders(targetYear) {
  if (!state.years.length) return;
  const snap = nearestBorder(targetYear);
  if (state.currentBorderFilename === snap.filename) return;
  if (builtBorders.has(snap.filename)) { showBorderLayer(builtBorders.get(snap.filename), snap.filename); return; }
  showLoading("경계 로딩 중…");
  try {
    const geo = await loadBorderFile(snap.filename);
    const gj = L.geoJSON(geo, { pane: "borderPane", renderer: borderRenderer, smoothFactor: 2, style: borderStyle, onEachFeature: (f, lyr) => {
      const p = f.properties || {};
      lyr.bindTooltip(p.NAME || "(미상)", { className: "border-label" });
      lyr.bindPopup(`<div class="event-popup"><h3>${escapeHtml(p.NAME || "(미상)")}</h3><div class="pop-meta">종주국: ${escapeHtml(p.SUBJECTO || "—")} · 문화권: ${escapeHtml(p.PARTOF || "—")} · 정밀도 ${precisionOf(p)}</div></div>`);
    } });
    builtBorders.set(snap.filename, gj);
    showBorderLayer(gj, snap.filename);
  } catch (e) { console.error(e); showLoading("⚠ " + e.message); return; }
  showLoading(null);
}

// ─── 사건 필터 + 렌더
function activeEvents() {
  const half = (state.mode === "scene" ? (state.scene.step || 1) : GLOBAL_STEP) / 2;
  const from = state.year - half, to = state.year + half;
  const bounds = state.mode === "scene" ? L.latLngBounds(state.scene.bounds) : null;
  return state.events.filter((ev) => {
    const s = ev.start, e = ev.end ?? ev.start;
    if (!(s <= to && e >= from)) return false;
    if (state.mode === "scene") { if (ev.sceneId === state.scene.id) return true; const rl = repLatLng(ev); return rl && bounds.contains(rl); }
    return true;
  });
}
function renderEvents() {
  eventLayer.clearLayers();
  const active = activeEvents();
  const byRegion = new Map();
  for (const ev of active) { drawEvent(ev); if (!byRegion.has(ev.region)) byRegion.set(ev.region, []); byRegion.get(ev.region).push(ev); }
  renderPanel(byRegion, active.length);
}
function drawEvent(ev) {
  const color = REGION_COLORS[ev.region] || DEFAULT_REGION_COLOR;
  if (ev.geom.type === "point") {
    const m = L.circleMarker(ev.geom.latlng, { pane: "eventPane", radius: 7, color: "#0b1020", weight: 1.5, fillColor: color, fillOpacity: 0.95 });
    m.bindPopup(popupHtml(ev), { maxWidth: 340 }); m.eventId = ev.id; eventLayer.addLayer(m);
  } else if (ev.geom.type === "route") {
    const line = L.polyline(ev.geom.latlngs, { pane: "eventPane", color, weight: 3, opacity: 0.9, dashArray: "6,5" });
    line.bindPopup(popupHtml(ev), { maxWidth: 340 }); line.eventId = ev.id; eventLayer.addLayer(line);
    ev.geom.latlngs.forEach((ll, i) => {
      const wp = ev.geom.waypoints?.[i];
      const dot = L.circleMarker(ll, { pane: "eventPane", radius: 4, color: "#0b1020", weight: 1, fillColor: color, fillOpacity: 1 });
      if (wp) dot.bindTooltip(`${i + 1}. ${escapeHtml(wp.name)}${wp.date ? " · " + escapeHtml(wp.date) : ""}`, { direction: "top" });
      eventLayer.addLayer(dot);
    });
  } else {
    const poly = L.polygon(ev.geom.rings, { pane: "eventPane", color, weight: 2, opacity: 0.9, fillColor: color, fillOpacity: 0.18, dashArray: "5,5" });
    poly.bindPopup(popupHtml(ev), { maxWidth: 340 }); poly.eventId = ev.id; eventLayer.addLayer(poly);
  }
}
function popupHtml(ev) {
  const period = ev.end != null ? `${yearText(ev.start)} ~ ${yearText(ev.end)}` : yearText(ev.start);
  let wp = "";
  if (ev.geom.type === "route" && ev.geom.waypoints) wp = '<div class="wp">경유: ' + ev.geom.waypoints.map((w, i) => `${i + 1}.${escapeHtml(w.name)}`).join(" → ") + "</div>";
  const play = ev.geom.type === "route" ? `<button class="play-route" data-anim="${ev.id}">▶ 경로 재생</button>` : "";
  return `<div class="event-popup"><h3>${escapeHtml(ev.title)}</h3>` +
    `<div class="pop-meta">${escapeHtml(ev.region)}${ev.category ? " · " + escapeHtml(ev.category) : ""} · ${period} · ${GEO_LABEL[ev.geom.type]}</div>` +
    `<div class="md-body">${md(ev.body)}</div>${wp}${play}</div>`;
}
function renderPanel(byRegion, total) {
  const list = $("#region-list"); list.innerHTML = "";
  if (total === 0) { list.innerHTML = '<div class="empty-note">이 시점에는 표시할 사건이 없습니다.<br>슬라이더를 움직여 다른 시대를 보거나, content/events 에 .md 를 추가하세요.</div>'; return; }
  const order = Object.keys(REGION_COLORS);
  const regions = [...byRegion.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  for (const region of regions) {
    const group = document.createElement("div"); group.className = "region-group";
    group.innerHTML = `<div class="region-group-head"><span class="region-dot r-${region}"></span>${escapeHtml(region)}<span class="region-count">${byRegion.get(region).length}건</span></div>`;
    for (const ev of byRegion.get(region)) {
      const item = document.createElement("div"); item.className = "event-item";
      const period = ev.end != null ? `${yearShort(ev.start)}~${yearShort(ev.end)}` : yearShort(ev.start);
      item.innerHTML = `<div class="ev-main"><div class="event-title">${escapeHtml(ev.title)}<span class="geo-tag">${GEO_LABEL[ev.geom.type]}</span></div><div class="event-meta">${period} · ${escapeHtml(ev.region)}</div></div>`;
      item.addEventListener("click", () => focusEvent(ev.id));
      group.appendChild(item);
    }
    list.appendChild(group);
  }
}
function focusEvent(id) {
  let t = null; eventLayer.eachLayer((l) => { if (l.eventId === id) t = l; });
  if (!t) return;
  if (t.getBounds) map.fitBounds(t.getBounds().pad(0.4), { maxZoom: 6 }); else map.panTo(t.getLatLng());
  t.openPopup();
}

// ─── 경로 애니메이션
function animateRoute(id) {
  const ev = state.events.find((e) => e.id === id); if (!ev || ev.geom.type !== "route") return;
  if (state.anim) cancelAnimationFrame(state.anim.raf); animLayer.clearLayers();
  const pts = ev.geom.latlngs, color = REGION_COLORS[ev.region] || DEFAULT_REGION_COLOR;
  const dot = L.circleMarker(pts[0], { pane: "eventPane", radius: 8, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 }).addTo(animLayer);
  const trail = L.polyline([pts[0]], { pane: "eventPane", color: "#fff", weight: 3, opacity: 0.95 }).addTo(animLayer);
  const seg = []; let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = map.distance(pts[i - 1], pts[i]); seg.push(d); total += d; }
  const dur = Math.min(9000, Math.max(3500, pts.length * 1400)); let t0 = null;
  function frame(ts) {
    if (t0 == null) t0 = ts; const t = Math.min(1, (ts - t0) / dur);
    let dist = t * total, i = 0; while (i < seg.length && dist > seg[i]) { dist -= seg[i]; i++; }
    let pos; if (i >= seg.length) pos = pts[pts.length - 1]; else { const r = seg[i] ? dist / seg[i] : 0; pos = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * r, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * r]; }
    dot.setLatLng(pos); trail.setLatLngs([...pts.slice(0, i + 1), pos]);
    if (t < 1) state.anim = { raf: requestAnimationFrame(frame) }; else setTimeout(() => animLayer.clearLayers(), 1200);
  }
  state.anim = { raf: requestAnimationFrame(frame) };
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-anim]"); if (b) animateRoute(b.getAttribute("data-anim")); });

// ─── 타임라인
function setYear(year, { fromSlider = false } = {}) {
  state.year = year; if (state.mode === "global") state.globalYear = year;
  if (!fromSlider) slider.value = year;
  $("#year-label").textContent = yearText(year);
  if (state.mode === "scene") { $("#year-sub").textContent = `· ${state.scene.title}`; scheduleBorders(state.scene.borderYear); }
  else { $("#year-sub").textContent = ""; scheduleBorders(year); }
  renderEvents();
}
function buildTimeline() {
  if (state.mode === "scene") {
    const sc = state.scene; slider.min = sc.start; slider.max = sc.end; slider.step = sc.step || 1; slider.value = state.year;
    $("#mode-badge").textContent = `${sc.title.split(" — ")[0]} · ${sc.step || 1}년`; buildTicks(sc.start, sc.end);
  } else {
    const min = state.years[0].year, max = state.years[state.years.length - 1].year;
    slider.min = min; slider.max = max; slider.step = GLOBAL_STEP; slider.value = state.year;
    $("#mode-badge").textContent = `전 세계 · ${GLOBAL_STEP}년`;
    buildTicks(min, max, [-2000, -1000, -300, 1, 500, 1000, 1492, 1815, 1900, 2010]);
  }
}
function buildTicks(min, max, nice) {
  const wrap = $("#tick-labels"); wrap.innerHTML = "";
  let marks;
  if (nice) marks = nice.filter((y) => y >= min && y <= max);
  else { const span = max - min, st = span <= 20 ? 5 : span <= 60 ? 10 : Math.ceil(span / 8 / 10) * 10; marks = []; for (let y = Math.ceil(min / st) * st; y <= max; y += st) marks.push(y); if (marks[0] !== min) marks.unshift(min); }
  for (const y of marks) { const s = document.createElement("span"); s.textContent = yearShort(y); s.style.left = `${((y - min) / (max - min)) * 100}%`; wrap.appendChild(s); }
}

// ─── 장면
function buildSceneSelect() {
  const sel = $("#scene-select");
  sel.querySelectorAll("option:not([value=''])").forEach((o) => o.remove());
  for (const sc of state.scenes) { const o = document.createElement("option"); o.value = sc.id; o.textContent = sc.title; sel.appendChild(o); }
}
function enterScene(sc) {
  state.mode = "scene"; state.scene = sc; $("#scene-desc").textContent = sc.body || "";
  state.currentBorderFilename = null; buildTimeline();
  map.fitBounds(L.latLngBounds(sc.bounds), { padding: [20, 20] }); setYear(sc.start);
}
function exitScene() {
  state.mode = "global"; state.scene = null; $("#scene-desc").textContent = ""; $("#scene-select").value = "";
  buildTimeline(); map.setView([25, 15], 2); setYear(state.globalYear);
}

// ─── UI 바인딩
function bindUI() {
  slider.addEventListener("input", () => setYear(parseInt(slider.value, 10), { fromSlider: true }));
  $("#play-btn").addEventListener("click", togglePlay);
  $("#scene-select").addEventListener("change", (e) => { const sc = state.scenes.find((s) => s.id === e.target.value); sc ? enterScene(sc) : exitScene(); });
  $("#info-toggle").addEventListener("click", () => ($("#info-modal").hidden = false));
  $("#info-close").addEventListener("click", () => ($("#info-modal").hidden = true));
  $("#info-modal").addEventListener("click", (e) => { if (e.target.id === "info-modal") $("#info-modal").hidden = true; });
  document.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    if (e.key === "ArrowRight") setYear(Math.min(+slider.max, state.year + (+slider.step)));
    if (e.key === "ArrowLeft") setYear(Math.max(+slider.min, state.year - (+slider.step)));
    if (e.key === "Escape") $("#info-modal").hidden = true;
  });
}
function togglePlay() {
  const btn = $("#play-btn");
  if (state.playTimer) { clearInterval(state.playTimer); state.playTimer = null; btn.textContent = "▶"; return; }
  btn.textContent = "⏸";
  state.playTimer = setInterval(() => { const n = state.year + (+slider.step); if (n > +slider.max) { togglePlay(); return; } setYear(n); }, state.mode === "scene" ? 900 : 1600);
}

// ─── 부트스트랩
async function init() {
  try {
    showLoading("데이터 로딩 중…");
    const man = await loadManifest();
    applyManifest(man);
    if (!state.years.length) throw new Error("시대(eras)가 없습니다. content/manifest.json 을 빌드했나요? (npm run build)");
    await ensureBase("110m");
    buildSceneSelect(); bindUI();
    state.year = state.globalYear = 1490;
    buildTimeline(); setYear(1490);
    showLoading(null);
  } catch (e) { console.error(e); showLoading("⚠ " + e.message); }
}
init();
