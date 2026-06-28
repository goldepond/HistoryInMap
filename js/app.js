// 연도별 세계사 지도 v3 — 콘텐츠(.md) 기반 / 위키·Terraform식 관리
// 데이터 원천: content/*.md (프론트매터 + 마크다운). 서버가 매니페스트로 제공하고 편집을 파일에 저장.
// 기능: 지형(Natural Earth) + 시대별 국경 + 지점/경로/영역 사건(+경로 애니메이션)
//       + 2단계 타임라인 + 시대/장면/사건을 모두 추가·수정·삭제(원문 .md 편집)

const BASE_DIR = "data/basemap/";
const BORDERS_DIR = "data/borders/";
const MANIFEST_FALLBACK = "content/manifest.json";

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
  baseLevel: null, editing: false, playTimer: null, anim: null,
  docCtx: null, apiAvailable: null,
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
function downloadText(filename, text, type = "text/markdown") {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
function setSaveStatus(text, kind = "") { const el = $("#save-status"); if (el) { el.textContent = text; el.dataset.kind = kind; } }

// ─── 서버 API (없으면 폴백)
async function probeApi() {
  try { const r = await fetch("/api/content", { method: "OPTIONS" }); state.apiAvailable = r.ok || r.status === 204; }
  catch { state.apiAvailable = false; }
  setSaveStatus(state.apiAvailable ? "서버 연결됨 · 자동 저장" : "서버 미연결 · 파일로 내보내기", state.apiAvailable ? "ok" : "warn");
}
async function apiSend(method, pathStr, body) {
  try {
    const res = await fetch(pathStr, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error("status " + res.status);
    state.apiAvailable = true; return await res.json().catch(() => ({}));
  } catch { state.apiAvailable = false; return null; }
}

// ─── 매니페스트 로드/적용
async function loadManifest() {
  let man = null;
  try { man = await fetchJSON("/api/content"); state.apiAvailable = true; }
  catch { man = await fetchJSON(MANIFEST_FALLBACK); state.apiAvailable = false; }
  return man;
}
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
  if (state.editing && $("#edit-borders").checked) enableBorderEdit(true);
}

// 슬라이더를 빠르게 끌 때 무거운 파일을 연속 파싱하지 않도록 경계 로딩을 디바운스
let borderTimer = null, pendingBorderYear = null;
function scheduleBorders(year) {
  const snap = state.years.length ? nearestBorder(year) : null;
  const badge = $("#border-badge");
  if (snap) { badge.hidden = false; badge.innerHTML = `경계 기준: <strong>${yearText(snap.year)}</strong>` + (snap.year !== year ? ` <span class="muted">(가장 가까운 시대 지도)</span>` : ""); }
  if (!snap || state.currentBorderFilename === snap.filename) return;
  if (builtBorders.has(snap.filename)) { showBorderLayer(builtBorders.get(snap.filename), snap.filename); return; } // 캐시 즉시
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
  if (state.editing) return state.events;
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
function attachEdit(ev, layer, type) {
  if (!state.editing) return;
  layer.on("pm:edit", () => updateEventGeometry(ev.id, layer, type));
  layer.on("pm:dragend", () => updateEventGeometry(ev.id, layer, type));
  layer.on("pm:remove", () => deleteDoc("events", ev.id));
}
function drawEvent(ev) {
  const color = REGION_COLORS[ev.region] || DEFAULT_REGION_COLOR;
  if (ev.geom.type === "point") {
    const m = L.circleMarker(ev.geom.latlng, { pane: "eventPane", radius: 7, color: "#0b1020", weight: 1.5, fillColor: color, fillOpacity: 0.95 });
    m.bindPopup(popupHtml(ev), { maxWidth: 340 }); m.eventId = ev.id; eventLayer.addLayer(m); attachEdit(ev, m, "point");
  } else if (ev.geom.type === "route") {
    const line = L.polyline(ev.geom.latlngs, { pane: "eventPane", color, weight: 3, opacity: 0.9, dashArray: "6,5" });
    line.bindPopup(popupHtml(ev), { maxWidth: 340 }); line.eventId = ev.id; eventLayer.addLayer(line); attachEdit(ev, line, "route");
    if (!state.editing) ev.geom.latlngs.forEach((ll, i) => {
      const wp = ev.geom.waypoints?.[i];
      const dot = L.circleMarker(ll, { pane: "eventPane", radius: 4, color: "#0b1020", weight: 1, fillColor: color, fillOpacity: 1 });
      if (wp) dot.bindTooltip(`${i + 1}. ${escapeHtml(wp.name)}${wp.date ? " · " + escapeHtml(wp.date) : ""}`, { direction: "top" });
      eventLayer.addLayer(dot);
    });
  } else {
    const poly = L.polygon(ev.geom.rings, { pane: "eventPane", color, weight: 2, opacity: 0.9, fillColor: color, fillOpacity: 0.18, dashArray: "5,5" });
    poly.bindPopup(popupHtml(ev), { maxWidth: 340 }); poly.eventId = ev.id; eventLayer.addLayer(poly); attachEdit(ev, poly, "area");
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
  if (total === 0) { list.innerHTML = '<div class="empty-note">이 시점에는 표시할 사건이 없습니다.<br>슬라이더를 움직이거나 ✎ 편집으로 추가하세요.</div>'; return; }
  const order = Object.keys(REGION_COLORS);
  const regions = [...byRegion.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  for (const region of regions) {
    const group = document.createElement("div"); group.className = "region-group";
    group.innerHTML = `<div class="region-group-head"><span class="region-dot r-${region}"></span>${escapeHtml(region)}<span class="region-count">${byRegion.get(region).length}건</span></div>`;
    for (const ev of byRegion.get(region)) {
      const item = document.createElement("div"); item.className = "event-item" + (state.editing ? " editing" : "");
      const period = ev.end != null ? `${yearShort(ev.start)}~${yearShort(ev.end)}` : yearShort(ev.start);
      const main = document.createElement("div"); main.className = "ev-main";
      main.innerHTML = `<div class="event-title">${escapeHtml(ev.title)}<span class="geo-tag">${GEO_LABEL[ev.geom.type]}</span></div><div class="event-meta">${period} · ${escapeHtml(ev.region)}</div>`;
      main.addEventListener("click", () => focusEvent(ev.id));
      item.appendChild(main);
      if (state.editing) item.appendChild(rowActions(() => openDoc("events", ev.id), () => confirm(`'${ev.title}' 삭제?`) && deleteDoc("events", ev.id)));
      group.appendChild(item);
    }
    list.appendChild(group);
  }
}
function rowActions(onEdit, onDel) {
  const act = document.createElement("div"); act.className = "ev-actions";
  const eb = document.createElement("button"); eb.className = "mini"; eb.textContent = "✏"; eb.title = "수정(.md)";
  eb.addEventListener("click", (e) => { e.stopPropagation(); onEdit(); });
  const db = document.createElement("button"); db.className = "mini danger"; db.textContent = "🗑"; db.title = "삭제";
  db.addEventListener("click", (e) => { e.stopPropagation(); onDel(); });
  act.append(eb, db); return act;
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

// ─── 편집 (Geoman)
function toggleEdit() {
  state.editing = !state.editing;
  $("#edit-toggle").setAttribute("aria-pressed", String(state.editing));
  $("#edit-panel").hidden = !state.editing;
  $("#manage-panel").hidden = !state.editing;
  if (state.editing) {
    map.pm.addControls({ position: "topright", drawMarker: true, drawPolyline: true, drawPolygon: true,
      drawCircle: false, drawCircleMarker: false, drawRectangle: false, drawText: false, editMode: true, dragMode: true, removalMode: true, rotateMode: false, cutPolygon: false });
    try { map.pm.setLang("ko"); } catch {}
    if (state.apiAvailable === null) probeApi(); else setSaveStatus(state.apiAvailable ? "서버 연결됨 · 자동 저장" : "서버 미연결 · 파일로 내보내기", state.apiAvailable ? "ok" : "warn");
    renderManage();
  } else { map.pm.removeControls(); enableBorderEdit(false); }
  renderEvents();
}
function enableBorderEdit(on) {
  if (!state.currentBorderGeoLayer) return;
  state.currentBorderGeoLayer.eachLayer((l) => { if (l.pm) on ? l.pm.enable({ allowSelfIntersection: false }) : l.pm.disable(); });
}
map.on("pm:create", (e) => {
  const shape = { Marker: "point", Line: "route", Polygon: "area" }[e.shape];
  if (!shape) { e.layer.remove(); return; }
  const raw = eventTemplate(shape, geomToFile(e.layer, shape).coordinates);
  openDoc("events", `evt-${Date.now()}`, { isNew: true, layer: e.layer, raw });
});
function geomToFile(layer, geometry) {
  if (geometry === "point") { const { lat, lng } = layer.getLatLng(); return { coordinates: [lng, lat] }; }
  if (geometry === "route") return { coordinates: layer.getLatLngs().map((p) => [p.lng, p.lat]) };
  const ring = layer.getLatLngs()[0].map((p) => [p.lng, p.lat]); if (ring.length) ring.push(ring[0]); return { coordinates: [ring] };
}
async function updateEventGeometry(id, layer, type) {
  const g = geomToFile(layer, type); const ev = state.events.find((e) => e.id === id);
  const payload = { geometry: type, coordinates: g.coordinates };
  if (type === "route" && ev?.geom.waypoints && ev.geom.waypoints.length === g.coordinates.length)
    { payload.waypoints = ev.geom.waypoints.map((w, i) => ({ ...w, lng: g.coordinates[i][0], lat: g.coordinates[i][1] })); delete payload.coordinates; }
  const r = await apiSend("PUT", `/api/content/events/${id}/geometry`, payload);
  if (r) { setSaveStatus("저장됨 ✓", "ok"); await reloadAndRender(); }
  else setSaveStatus("서버 미연결 — 위치 변경 미저장", "warn");
}

// ─── 문서 편집기 (위키식 원문 .md)
function eventTemplate(geometry, coordinates) {
  return ["---", "title: 새 사건", "region: 유럽", "category: ", `start: ${state.year}`, "end: ",
    `geometry: ${geometry}`, `coordinates: ${JSON.stringify(coordinates)}`,
    geometry === "route" ? "animate: true" : null, "---", "", "여기에 **마크다운**으로 내용을 작성하세요.", ""]
    .filter((l) => l !== null).join("\n");
}
function sceneTemplate() {
  const b = map.getBounds();
  return ["---", "title: 새 장면", `start: ${state.year}`, `end: ${state.year + 20}`, "step: 1",
    `borderYear: ${nearestBorder(state.year).year}`,
    `bounds: [[${b.getSouth().toFixed(1)},${b.getWest().toFixed(1)}],[${b.getNorth().toFixed(1)},${b.getEast().toFixed(1)}]]`,
    "---", "", "장면 설명을 적으세요.", ""].join("\n");
}
function eraTemplate() {
  return ["---", `year: ${state.year}`, `borderFile: ${state.currentBorderFilename || "world_1492.geojson"}`, "label: 새 시대",
    "---", "", "이 시대에 대한 설명.", ""].join("\n");
}
async function openDoc(type, id, opts = {}) {
  let raw = opts.raw;
  if (raw == null) { // 기존 문서 → 원문 가져오기
    try { raw = await (await fetch(`content/${type}/${id}.md`)).text(); }
    catch { raw = ""; }
  }
  state.docCtx = { type, id, isNew: !!opts.isNew, layer: opts.layer || null };
  $("#doc-title").textContent = `${opts.isNew ? "새 " : ""}${docTypeLabel(type)} · ${id}.md`;
  $("#doc-raw").value = raw;
  $("#doc-delete").style.display = opts.isNew ? "none" : "";
  renderDocPreview();
  $("#doc-modal").hidden = false;
  $("#doc-raw").focus();
}
const docTypeLabel = (t) => ({ events: "사건", scenes: "장면", eras: "시대" }[t] || t);
function splitBody(raw) { const m = /^---\s*\n[\s\S]*?\n---\s*\n?([\s\S]*)$/.exec(raw); return m ? m[1] : raw; }
function renderDocPreview() { $("#doc-preview").innerHTML = md(splitBody($("#doc-raw").value)); }
async function saveDoc() {
  const ctx = state.docCtx; if (!ctx) return;
  const raw = $("#doc-raw").value;
  setSaveStatus("저장 중…", "pending");
  const r = await apiSend("PUT", `/api/content/${ctx.type}/${ctx.id}`, { raw });
  if (r) {
    if (ctx.isNew && ctx.layer) ctx.layer.remove();
    setSaveStatus("저장됨 ✓", "ok"); $("#doc-modal").hidden = true; state.docCtx = null;
    await reloadAndRender();
  } else {
    setSaveStatus("서버 미연결 → .md 다운로드", "warn");
    downloadText(`${ctx.id}.md`, raw);
    alert(`서버가 없어 파일로 내려받았습니다.\ncontent/${ctx.type}/ 에 넣고 새로고침하세요.`);
  }
}
async function deleteDoc(type, id) {
  const r = await apiSend("DELETE", `/api/content/${type}/${id}`);
  if (r) { setSaveStatus("삭제됨 ✓", "ok"); if (state.docCtx?.id === id) { $("#doc-modal").hidden = true; state.docCtx = null; } await reloadAndRender(); }
  else setSaveStatus("서버 미연결 — 삭제는 파일을 직접 지우세요", "warn");
}
function cancelDoc() {
  if (state.docCtx?.isNew && state.docCtx.layer) state.docCtx.layer.remove();
  state.docCtx = null; $("#doc-modal").hidden = true;
}

// ─── 관리 패널(시대·장면 추가/수정/삭제)
function renderManage() {
  const eras = $("#manage-eras"); eras.innerHTML = "";
  for (const e of state.eras) {
    const row = document.createElement("div"); row.className = "manage-item";
    row.innerHTML = `<span>${yearShort(e.year)} · ${escapeHtml(e.label || e.borderFile)}</span>`;
    row.appendChild(rowActions(() => openDoc("eras", e.id), () => confirm(`시대 '${e.label || e.id}' 삭제?`) && deleteDoc("eras", e.id)));
    eras.appendChild(row);
  }
  const scenes = $("#manage-scenes"); scenes.innerHTML = "";
  for (const s of state.scenes) {
    const row = document.createElement("div"); row.className = "manage-item";
    row.innerHTML = `<span>${escapeHtml(s.title)}</span>`;
    row.appendChild(rowActions(() => openDoc("scenes", s.id), () => confirm(`장면 '${s.title}' 삭제?`) && deleteDoc("scenes", s.id)));
    scenes.appendChild(row);
  }
}

// ─── 국경 저장 / 내보내기
async function saveBorders() {
  if (!state.currentBorderGeoLayer) return;
  const geo = state.currentBorderGeoLayer.toGeoJSON(); const fn = state.currentBorderFilename;
  setSaveStatus("경계 저장 중…", "pending");
  const r = await apiSend("PUT", `/api/borders/${fn}`, geo);
  if (r) { state.borderCache.set(fn, geo); setSaveStatus(`경계 저장됨 ✓ (${fn})`, "ok"); }
  else { setSaveStatus("서버 미연결 → 파일로 내려받음", "warn"); downloadText(fn, JSON.stringify(geo), "application/json"); }
}

// ─── 재로딩
async function reloadAndRender() {
  const man = await loadManifest();
  applyManifest(man);
  buildSceneSelect();
  if (state.mode === "scene") { const sc = state.scenes.find((s) => s.id === state.scene.id); if (sc) state.scene = sc; else return exitScene(); }
  state.currentBorderFilename = null; // 시대/경계가 바뀌었을 수 있음
  builtBorders.clear(); state.borderCache.clear(); // 디스크 변경 반영 위해 캐시 비움
  buildTimeline();
  setYear(Math.max(+slider.min, Math.min(+slider.max, state.year)));
  if (state.editing) renderManage();
}

// ─── UI 바인딩
function bindUI() {
  slider.addEventListener("input", () => setYear(parseInt(slider.value, 10), { fromSlider: true }));
  $("#play-btn").addEventListener("click", togglePlay);
  $("#scene-select").addEventListener("change", (e) => { const sc = state.scenes.find((s) => s.id === e.target.value); sc ? enterScene(sc) : exitScene(); });
  $("#edit-toggle").addEventListener("click", toggleEdit);
  $("#edit-borders").addEventListener("change", (e) => enableBorderEdit(e.target.checked));
  $("#save-borders").addEventListener("click", saveBorders);
  $("#add-era").addEventListener("click", () => openDoc("eras", `era-${Date.now()}`, { isNew: true, raw: eraTemplate() }));
  $("#add-scene").addEventListener("click", () => openDoc("scenes", `scene-${Date.now()}`, { isNew: true, raw: sceneTemplate() }));
  $("#doc-raw").addEventListener("input", renderDocPreview);
  $("#doc-save").addEventListener("click", saveDoc);
  $("#doc-delete").addEventListener("click", () => { const c = state.docCtx; if (c && confirm("이 문서를 삭제할까요?")) deleteDoc(c.type, c.id); });
  $("#doc-cancel").addEventListener("click", cancelDoc);
  $("#info-toggle").addEventListener("click", () => ($("#info-modal").hidden = false));
  $("#info-close").addEventListener("click", () => ($("#info-modal").hidden = true));
  $("#info-modal").addEventListener("click", (e) => { if (e.target.id === "info-modal") $("#info-modal").hidden = true; });
  document.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    if (e.key === "ArrowRight") setYear(Math.min(+slider.max, state.year + (+slider.step)));
    if (e.key === "ArrowLeft") setYear(Math.max(+slider.min, state.year - (+slider.step)));
    if (e.key === "Escape") { $("#info-modal").hidden = true; cancelDoc(); }
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
    if (!state.years.length) throw new Error("시대(eras)가 없습니다. migrate 스크립트를 실행했나요?");
    await ensureBase("110m");
    buildSceneSelect(); bindUI();
    state.year = state.globalYear = 1490;
    buildTimeline(); setYear(1490);
    showLoading(null);
  } catch (e) { console.error(e); showLoading("⚠ " + e.message + " — node server.mjs 로 열었는지 확인하세요."); }
}
init();
