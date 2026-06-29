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
  baseLevel: null, playTimer: null, speed: 1, picking: false, coordPin: null, theme: "dark",
  terrain: false, reliefLayer: null, riverOn: true, borderOn: true,
};
const SPEEDS = [0.5, 1, 2, 4];
// 지도 색 팔레트(테마별) — 바다·땅·해안선·강·국경
const THEMES = {
  dark:  { land: "#313b49", coast: "#62788a", ocean: "#0a1826", lakeStroke: "#1c3346", river: "#5e9ad6", borderStroke: "#0a1018", empty: "#46536b", subjSL: "58%, 58%", mtn: "#b07c3f", mtnEdge: "#5e3f1c" },
  light: { land: "#e8e2d6", coast: "#ab9f88", ocean: "#bcd5e8", lakeStroke: "#88aec9", river: "#3f7cc0", borderStroke: "#6f6552", empty: "#cbc4b4", subjSL: "42%, 62%", mtn: "#a86f30", mtnEdge: "#6b461c" },
};
const theme = () => THEMES[state.theme];
try { document.documentElement.setAttribute("data-theme", localStorage.getItem("theme") || "dark"); } catch {} // CSS 깜빡임 방지

const $ = (s) => document.querySelector(s);
const slider = $("#year-slider");
const md = (s) => (window.marked ? window.marked.parse(s || "") : escapeHtml(s || ""));

// ─── 지도 (정사각 투영 EPSG:4326 — 면적 왜곡 적고 지형 이미지와 정렬됨)
const WORLD_BOUNDS = [[-56, -168], [80, 180]]; // 전 세계 기본 보기(거주권 위주)
// 지형도 = NASA GIBS의 EPSG:4326 컬러 음영기복 타일(ASTER GDEM, 실제 30m DEM, 12레벨). 무료·무인증·줌해도 선명.
const GIBS_RELIEF = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/ASTER_GDEM_Color_Shaded_Relief/default/31.25m/{z}/{y}/{x}.jpeg";
// GIBS EPSG:4326 타일과 줌-해상도를 1:1 정렬: 기본 scale 256 → 320 (res0=0.5625°/px = GIBS 31.25m 매트릭스)
const CRS_GIBS = L.extend({}, L.CRS.EPSG4326, {
  scale: (z) => 320 * Math.pow(2, z),
  zoom: (s) => Math.log(s / 320) / Math.LN2,
});
const map = L.map("map", { crs: CRS_GIBS, minZoom: 0, maxZoom: 9,
  maxBounds: [[-90, -180], [90, 180]], maxBoundsViscosity: 0.6 });
map.createPane("basePane").style.zIndex = 200;    // 평면 배경(땅·호수)
map.createPane("reliefPane").style.zIndex = 250;  // 지형도 이미지(배경 위, 강·국경 아래)
map.createPane("riverPane").style.zIndex = 280;   // 강(지형도 위에도 보이도록 별도 레이어)
map.createPane("borderPane").style.zIndex = 300;
map.createPane("eventPane").style.zIndex = 450;
// 성능: 수천 폴리곤을 DOM(SVG) 대신 캔버스에 그린다 → 팬/줌이 매끄러움
const baseRenderer = L.canvas({ pane: "basePane", padding: 0.4 });
const riverRenderer = L.canvas({ pane: "riverPane", padding: 0.4 });
const borderRenderer = L.canvas({ pane: "borderPane", padding: 0.4 });
map.attributionControl.setPrefix(false);
map.attributionControl.addAttribution('경계 historical-basemaps · 지형 Natural Earth');
const baseLayer = L.layerGroup().addTo(map);
const riverLayer = L.layerGroup().addTo(map);  // 강 — 지형도 ON 일 때도 위에 유지
const borderLayer = L.layerGroup().addTo(map);
const eventLayer = L.layerGroup().addTo(map);
map.fitBounds(WORLD_BOUNDS); // 초기 전 세계 보기(정사각 투영엔 center/zoom 대신 범위로)

// ─── 유틸
const yearText = (y) => (y < 0 ? `기원전 ${Math.abs(y)}년` : `서기 ${y}년`);
const yearShort = (y) => (y < 0 ? `BC${Math.abs(y)}` : `${y}`);
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// cache:"no-cache" = 매번 조건부 요청(변경 없으면 304, 작음) → push 후 새 데이터가 바로 반영됨
async function fetchJSON(url) { const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw new Error(`${url} (${r.status})`); return r.json(); }
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
  baseLayer.clearLayers(); riverLayer.clearLayers();
  // 땅: 밝은 슬레이트 + 또렷한 해안선(바다와 명확히 구분)
  const t = theme();
  baseLayer.addLayer(L.geoJSON(land, { ...opt, style: { color: t.coast, weight: 0.9, fillColor: t.land, fillOpacity: 1 } }));
  // 호수: 바다와 같은 짙은 남색
  baseLayer.addLayer(L.geoJSON(lakes, { ...opt, style: { color: t.lakeStroke, weight: 0.5, fillColor: t.ocean, fillOpacity: 1 } }));
  // 강: 별도 riverPane(지형도 위에도 보이게), 선명하게
  riverLayer.addLayer(L.geoJSON(rivers, { pane: "riverPane", interactive: false, renderer: riverRenderer, smoothFactor: 2, style: { color: t.river, weight: 1.9, opacity: 0.9 } }));
}
map.on("zoomend", () => ensureBase(map.getZoom() >= 4 ? "50m" : "110m"));

// ─── 국경
function nearestBorder(year) { return state.years.reduce((b, y) => Math.abs(y.year - year) < Math.abs(b.year - year) ? y : b, state.years[0]); }
function precisionOf(p) { const n = parseInt(p.BORDERPRECISION, 10); return Number.isFinite(n) ? n : 2; }
function colorForSubject(s) { s = (s || "").trim(); if (!s) return theme().empty; let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return `hsl(${h}, ${theme().subjSL})`; }
function borderStyle(f) {
  const p = f.properties || {}, prec = precisionOf(p);
  return { color: theme().borderStroke, weight: prec >= 3 ? 1 : prec === 2 ? 0.8 : 0.6, dashArray: prec >= 3 ? null : prec === 2 ? "3,3" : "1,4",
    fillColor: colorForSubject(p.SUBJECTO || p.NAME), fillOpacity: prec >= 3 ? 0.5 : prec === 2 ? 0.4 : 0.24 };
}
async function loadBorderFile(fn) { if (state.borderCache.has(fn)) return state.borderCache.get(fn); const g = await fetchJSON(BORDERS_DIR + fn); state.borderCache.set(fn, g); return g; }

const builtBorders = new Map(); // filename → 이미 만들어 둔 L.geoJSON (재방문 즉시 표시)
function showBorderLayer(gj, filename) {
  borderLayer.clearLayers(); borderLayer.addLayer(gj);
  state.currentBorderGeoLayer = gj; state.currentBorderFilename = filename;
  $("#legend").hidden = !state.borderOn;
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
      lyr.bindPopup(`<div class="event-popup"><h3>${escapeHtml(p.NAME || "(미상)")}</h3><div class="pop-meta">종주국: ${escapeHtml(p.SUBJECTO || "—")} · 문화권: ${escapeHtml(p.PARTOF || "—")} · 경계 신뢰도 ${precisionOf(p)}</div></div>`);
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
  $("#scene-progress").hidden = true; // 진행 캡션 초기화(경로가 있으면 아래에서 다시 표시)
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
    if (state.mode === "scene" && ev.sceneId === state.scene?.id) { drawRouteProgress(ev); return; } // 장면: 시간순 진행
    if (state.mode === "global") { drawRoutePin(ev); return; } // 전역: 대표 핀 1개로 접기(첫 waypoint)
    // 장면 안의 '다른' 경로(또는 장면 미지정): 전체 경로 표시
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
  const hint = (ev.geom.type === "route" && state.mode === "scene") ? `<div class="route-hint">⏱ 아래 타임라인을 움직이면 경로가 시간순으로 진행됩니다.</div>` : "";
  return `<div class="event-popup"><h3>${escapeHtml(ev.title)}</h3>` +
    `<div class="pop-meta">${escapeHtml(ev.region)}${ev.category ? " · " + escapeHtml(ev.category) : ""} · ${period} · ${GEO_LABEL[ev.geom.type]}</div>` +
    `<div class="md-body">${md(ev.body)}</div>${wp}${hint}</div>`;
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
      item.addEventListener("click", () => { if (!sceneFromEvent(ev)) focusEvent(ev.id); });
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
// 전역에서 경로를 첫 waypoint 위치에 '대표 핀' 하나로 접어 표시(흰 테두리로 구분)
function drawRoutePin(ev) {
  const color = REGION_COLORS[ev.region] || DEFAULT_REGION_COLOR;
  const ll = ev.geom.latlngs[0]; if (!ll) return;
  const scene = ev.sceneId ? state.scenes.find((s) => s.id === ev.sceneId) : null;
  const m = L.circleMarker(ll, { pane: "eventPane", radius: 7, color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.95 });
  m.bindTooltip(`${escapeHtml(ev.title)}${scene ? " · 클릭하면 장면으로" : ""}`, { direction: "top" });
  if (scene) m.on("click", () => sceneFromEvent(ev));
  else m.bindPopup(popupHtml(ev), { maxWidth: 340 });
  m.eventId = ev.id; eventLayer.addLayer(m);
}
// 경로가 장면에 묶여 있으면 그 장면으로 진입(전역에서만). 처리했으면 true.
function sceneFromEvent(ev) {
  if (state.mode !== "global" || ev.geom.type !== "route" || !ev.sceneId) return false;
  const sc = state.scenes.find((s) => s.id === ev.sceneId); if (!sc) return false;
  $("#scene-select").value = sc.id; enterScene(sc); return true;
}

// ─── 장면 내 경로의 '시간순 진행' (타임라인 연동 · 버튼 없음 · 비애니메이션)
//   현재 연도까지 도달=실선, 지금 구간=흰 굵은 선, 앞으로=흐린 점선, 현재 지점=큰 마커
const wpName = (ev, i) => ev.geom.waypoints?.[i]?.name || `지점 ${i + 1}`;
const wpDateText = (ev, i) => ev.geom.waypoints?.[i]?.date || "";
// 경유지 날짜 → 연도(BC는 음수). 날짜가 없으면 시작~종료에 균등 배분.
function wpYear(ev, i) {
  const d = ev.geom.waypoints?.[i]?.date;
  if (d) {
    let m;
    if ((m = /기원전\s*(\d+)/.exec(d))) return -(+m[1]);
    if ((m = /BC\s*(\d+)/i.exec(d))) return -(+m[1]);
    if ((m = /AD\s*(\d+)/i.exec(d))) return +m[1];
    if ((m = /-?\d{1,4}/.exec(d))) return +m[0]; // ISO "1492-08-03" → 1492
  }
  const n = ev.geom.latlngs.length, s = ev.start, e = ev.end ?? ev.start;
  return n > 1 ? Math.round(s + (e - s) * (i / (n - 1))) : s;
}
// 현재 연도 기준, 도달한 마지막 경유지 인덱스(아직이면 -1)
function reachedIndex(ev, year) {
  let idx = -1;
  for (let i = 0; i < ev.geom.latlngs.length; i++) { if (wpYear(ev, i) <= year) idx = i; else break; }
  return idx;
}
function drawRouteProgress(ev) {
  const color = REGION_COLORS[ev.region] || DEFAULT_REGION_COLOR;
  const pts = ev.geom.latlngs, k = reachedIndex(ev, state.year), fStart = Math.max(0, k);
  if (fStart < pts.length - 1) eventLayer.addLayer(L.polyline(pts.slice(fStart), { pane: "eventPane", color, weight: 2, opacity: 0.22, dashArray: "3,7", interactive: false }));
  if (k > 0) eventLayer.addLayer(L.polyline(pts.slice(0, k + 1), { pane: "eventPane", color, weight: 4, opacity: 0.9, interactive: false }));
  if (k >= 1) eventLayer.addLayer(L.polyline([pts[k - 1], pts[k]], { pane: "eventPane", color: "#fff", weight: 6, opacity: 0.95, interactive: false }));
  pts.forEach((ll, i) => {
    const current = i === k, done = i <= k;
    const dot = L.circleMarker(ll, { pane: "eventPane", radius: current ? 9 : 5,
      color: current ? "#fff" : "#0b1020", weight: current ? 3 : 1,
      fillColor: done ? color : "#1f2742", fillOpacity: done ? 1 : 0.5 });
    dot.bindTooltip(`${i + 1}. ${escapeHtml(wpName(ev, i))}${wpDateText(ev, i) ? " · " + escapeHtml(wpDateText(ev, i)) : ""}`, { direction: "top", permanent: current, className: "border-label" });
    dot.bindPopup(popupHtml(ev), { maxWidth: 340 }); dot.eventId = ev.id;
    eventLayer.addLayer(dot);
  });
  updateProgressCaption(ev, k);
}
function updateProgressCaption(ev, k) {
  const el = $("#scene-progress"); if (!el) return;
  const n = ev.geom.latlngs.length;
  let txt;
  if (k < 0) txt = `행군 전 — 첫 목적지: ${wpName(ev, 0)}`;
  else if (k === 0) txt = `출발 · ${wpName(ev, 0)}`;
  else txt = `${k + 1}/${n} · ${wpName(ev, k - 1)} → ${wpName(ev, k)}`;
  const date = k >= 0 ? wpDateText(ev, k) : "";
  el.innerHTML = `<span class="sp-flag">🚩</span><span>${escapeHtml(txt)}${date ? ` <b>(${escapeHtml(date)})</b>` : ""}</span>`;
  el.hidden = false;
}

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
  $("#scene-progress").hidden = true;
  buildTimeline(); map.fitBounds(WORLD_BOUNDS); setYear(state.globalYear);
}

// ─── UI 바인딩

// ─── 좌표 피커 (좌표 모드 ON일 때만 동작 · 기본 OFF)
const COORD_DECIMALS = 4; // 약 ~10m
const r4 = (n) => Math.round(n * 10 ** COORD_DECIMALS) / 10 ** COORD_DECIMALS;
let coordToastTimer = null;
function onCoordMove(e) {
  const lng = r4(e.latlng.lng), lat = r4(e.latlng.lat);
  $("#coord-readout").innerHTML =
    `<span class="cr-ll">경도 ${lng} · 위도 ${lat}</span><br>` +
    `복사값 <span class="cr-copy">[${lng}, ${lat}]</span><br>` +
    `<span class="cr-hint">클릭하면 클립보드에 복사</span>`;
}
// 물방울 핀(SVG) — 끝점이 정확한 지점을 가리킴
const COORD_PIN_ICON = L.divIcon({
  className: "coord-pin",
  html: '<svg width="22" height="30" viewBox="0 0 22 30" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M11 1C5.5 1 1 5.5 1 11c0 7.5 10 18 10 18s10-10.5 10-18C21 5.5 16.5 1 11 1z" fill="#ffce6b" stroke="#0b1020" stroke-width="1.6"/>' +
    '<circle cx="11" cy="11" r="3.4" fill="#0b1020"/></svg>',
  iconSize: [22, 30], iconAnchor: [11, 29], tooltipAnchor: [0, -26],
});
function placeCoordPin(latlng, text) {
  if (state.coordPin) state.coordPin.remove();
  state.coordPin = L.marker(latlng, { icon: COORD_PIN_ICON, interactive: false, keyboard: false })
    .bindTooltip(text, { permanent: true, direction: "top", className: "border-label" })
    .addTo(map);
}
async function onCoordClick(e) {
  const lng = r4(e.latlng.lng), lat = r4(e.latlng.lat);
  const text = `[${lng}, ${lat}]`;
  map.closePopup(); // 경계/사건 팝업이 겹쳐 뜨는 것 방지
  placeCoordPin(e.latlng, text); // 클릭한 정확한 지점에 핀
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; }
  catch {
    try { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); ok = document.execCommand("copy"); ta.remove(); } catch {}
  }
  const toast = $("#coord-toast");
  toast.textContent = (ok ? "복사됨: " : "복사 실패 — 수동 복사: ") + text;
  toast.hidden = false;
  clearTimeout(coordToastTimer);
  coordToastTimer = setTimeout(() => (toast.hidden = true), 1800);
}
function toggleCoord() {
  state.picking = !state.picking;
  $("#coord-toggle").setAttribute("aria-pressed", String(state.picking));
  map.getContainer().classList.toggle("picking", state.picking);
  // 국경·사건 pane이 클릭을 가로채지 않게(팝업 대신 좌표 복사가 항상 먹히도록)
  map.getPane("borderPane").classList.toggle("nohit", state.picking);
  map.getPane("eventPane").classList.toggle("nohit", state.picking);
  if (state.picking) {
    $("#coord-readout").innerHTML = '<span class="cr-hint">지도 위에서 움직이거나 클릭하세요</span>';
    $("#coord-readout").hidden = false;
    map.on("mousemove", onCoordMove);
    map.on("click", onCoordClick);
  } else {
    map.off("mousemove", onCoordMove);
    map.off("click", onCoordClick);
    $("#coord-readout").hidden = true;
    $("#coord-toast").hidden = true;
    if (state.coordPin) { state.coordPin.remove(); state.coordPin = null; } // 핀 제거
  }
}

function bindUI() {
  slider.addEventListener("input", () => setYear(parseInt(slider.value, 10), { fromSlider: true }));
  $("#play-btn").addEventListener("click", togglePlay);
  $("#theme-toggle").addEventListener("click", toggleTheme);
  $("#lyr-terrain").addEventListener("change", (e) => setTerrainLayer(e.target.checked));
  $("#lyr-river").addEventListener("change", (e) => setRiverLayer(e.target.checked));
  $("#lyr-border").addEventListener("change", (e) => setBorderLayer(e.target.checked));
  $("#speed-btn").addEventListener("click", cycleSpeed);
  $("#scene-select").addEventListener("change", (e) => { const sc = state.scenes.find((s) => s.id === e.target.value); sc ? enterScene(sc) : exitScene(); });
  $("#coord-toggle").addEventListener("click", toggleCoord);
  $("#info-toggle").addEventListener("click", () => ($("#info-modal").hidden = false));
  $("#info-close").addEventListener("click", () => ($("#info-modal").hidden = true));
  $("#info-modal").addEventListener("click", (e) => { if (e.target.id === "info-modal") $("#info-modal").hidden = true; });
  document.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    if (e.key === "ArrowRight") setYear(Math.min(+slider.max, state.year + (+slider.step)));
    if (e.key === "ArrowLeft") setYear(Math.max(+slider.min, state.year - (+slider.step)));
    if (e.key === "Escape") { $("#info-modal").hidden = true; if (state.picking) toggleCoord(); }
  });
}
const baseDelay = () => (state.mode === "scene" ? 900 : 1600);
function startPlayTimer() {
  clearInterval(state.playTimer);
  state.playTimer = setInterval(() => {
    const n = state.year + (+slider.step);
    if (n > +slider.max) { togglePlay(); return; }
    setYear(n);
  }, baseDelay() / state.speed);
}
// ─── 다크/라이트 테마
function applyTheme(th, { rerender = true } = {}) {
  state.theme = th;
  document.documentElement.setAttribute("data-theme", th);
  try { localStorage.setItem("theme", th); } catch {}
  const b = $("#theme-toggle"); if (b) b.textContent = th === "light" ? "🌙" : "☀️";
  if (!rerender) return;
  state.baseLevel = null; ensureBase(map.getZoom() >= 4 ? "50m" : "110m"); // 지형 색 다시 칠
  builtBorders.clear(); state.currentBorderFilename = null;                 // 국경 색 다시 칠
  scheduleBorders(state.mode === "scene" ? state.scene.borderYear : state.year);
}
function toggleTheme() { applyTheme(state.theme === "light" ? "dark" : "light"); }

// ─── 레이어 독립 토글: 지형도 / 강 / 국경 (서로 영향 없음)
function buildTerrainLegend() {
  const el = $("#terrain-legend"); if (!el || el.dataset.built) return;
  el.innerHTML = '<div class="legend-title">지형(고도)</div>' +
    '<div class="legend-row"><span class="swatch" style="background:#7fb060;border:none"></span>평지</div>' +
    '<div class="legend-row"><span class="swatch" style="background:#a9824e;border:none"></span>산지</div>' +
    '<div class="legend-row"><span class="swatch" style="background:#dcd6c0;border:none"></span>고봉</div>' +
    '<div class="legend-row"><span class="swatch" style="background:#6f99a8;border:none"></span>물</div>';
  el.dataset.built = "1";
}
// 인접 줌(±1) 타일을 현재 화면 범위만큼 미리 받아둠 → 줌하면 이미 캐시되어 즉시
function prefetchRelief() {
  if (!state.terrain) return;
  const b = map.getBounds(), z = map.getZoom();
  for (const Z of [z + 1, z - 1]) {
    if (Z < 0 || Z > 11) continue;
    const nw = map.project(b.getNorthWest(), Z), se = map.project(b.getSouthEast(), Z);
    const x0 = Math.floor(nw.x / 512), x1 = Math.floor(se.x / 512);
    const y0 = Math.floor(nw.y / 512), y1 = Math.floor(se.y / 512);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 80) continue; // 너무 많으면 생략(부하 방지)
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      if (x < 0 || y < 0) continue;
      const img = new Image();
      img.src = GIBS_RELIEF.replace("{z}", Z).replace("{x}", x).replace("{y}", y);
    }
  }
}
let prefetchTimer;
function schedulePrefetch() { clearTimeout(prefetchTimer); prefetchTimer = setTimeout(prefetchRelief, 350); }
map.on("moveend", schedulePrefetch);

// 지형도(GIBS 컬러 음영기복 타일) — 보이는 영역만 줌 단계별로 받아 빠르고, 줌해도 선명
function setTerrainLayer(on) {
  state.terrain = on;
  if (on) {
    if (!state.reliefLayer) state.reliefLayer = L.tileLayer(GIBS_RELIEF, {
      pane: "reliefPane", tileSize: 512, minZoom: 0, maxNativeZoom: 11, noWrap: true,
      bounds: [[-90, -180], [90, 180]], attribution: "지형 NASA GIBS · ASTER GDEM",
      keepBuffer: 4, updateWhenZooming: false, // 주변 타일 유지 + 줌 중 깜빡임↓
    });
    state.reliefLayer.addTo(map);
    buildTerrainLegend(); $("#terrain-legend").hidden = false;
    schedulePrefetch();
  } else {
    if (state.reliefLayer) map.removeLayer(state.reliefLayer);
    $("#terrain-legend").hidden = true;
  }
}
function setRiverLayer(on) {
  state.riverOn = on;
  if (on && !map.hasLayer(riverLayer)) map.addLayer(riverLayer);
  else if (!on && map.hasLayer(riverLayer)) map.removeLayer(riverLayer);
}
function setBorderLayer(on) {
  state.borderOn = on;
  if (on && !map.hasLayer(borderLayer)) map.addLayer(borderLayer);
  else if (!on && map.hasLayer(borderLayer)) map.removeLayer(borderLayer);
  $("#legend").hidden = !on;
}
function togglePlay() {
  const btn = $("#play-btn");
  if (state.playTimer) { clearInterval(state.playTimer); state.playTimer = null; btn.textContent = "▶"; return; }
  btn.textContent = "⏸"; startPlayTimer();
}
function cycleSpeed() {
  state.speed = SPEEDS[(SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length];
  $("#speed-btn").textContent = `${state.speed}×`;
  if (state.playTimer) startPlayTimer(); // 재생 중이면 즉시 반영
}

// ─── 부트스트랩
async function init() {
  try {
    showLoading("데이터 로딩 중…");
    const man = await loadManifest();
    applyManifest(man);
    if (!state.years.length) throw new Error("시대(eras)가 없습니다. content/manifest.json 을 빌드했나요? (npm run build)");
    try { applyTheme(localStorage.getItem("theme") || "dark", { rerender: false }); } catch { applyTheme("dark", { rerender: false }); }
    await ensureBase("110m");
    buildSceneSelect(); bindUI();
    state.year = state.globalYear = 1490;
    buildTimeline(); setYear(1490);
    showLoading(null);
  } catch (e) { console.error(e); showLoading("⚠ " + e.message); }
}
init();
// 지형 타일 영구 캐시(Service Worker) — 줌 인/아웃 왕복·재방문 시 네트워크 없이 즉시
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
