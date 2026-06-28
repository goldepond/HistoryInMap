#!/usr/bin/env node
// 표시용 경계 경량화: data/borders-src/*.geojson → data/borders/*.geojson
//   ① 좌표 3자리 반올림  ② Douglas–Peucker 단순화  ③ 연속 중복점 제거  ④ compact JSON
// 원본은 borders-src 에 보존. 위상(topology)은 보존하지 않음(참고용 지도이므로 미세 갭 허용).
//
// 실행:  node scripts/build-borders.mjs   ·   조정:  아래 EPSILON / DECIMALS

import { readFile, writeFile, mkdir, readdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "data", "borders-src");
const OUT = path.join(ROOT, "data", "borders");

const EPSILON = 0.03;   // 단순화 강도(도). 클수록 더 단순/가벼움. 0.01~0.05 권장
const DECIMALS = 3;     // 좌표 소수 자리(3 ≈ 110m)

// 아메리카 원주민(추정·정밀도1) 폴리곤 제거: 명나라는 한 덩이인데 북미만 수백 조각이라 과도.
// 원본(borders-src)은 보존되므로 되돌리려면 이 값을 false 로.
const DROP_AMERICAS_PREC1 = true;
const AMERICAS_LNG = [-170, -34]; // 아메리카 경도 범위(중심점 기준)
const AMERICAS_LAT = [-56, 73];

const round = (n) => Math.round(n * 10 ** DECIMALS) / 10 ** DECIMALS;

function bboxCenter(geom) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  (function rec(co) { if (typeof co[0] === "number") { if (co[0] < minX) minX = co[0]; if (co[0] > maxX) maxX = co[0]; if (co[1] < minY) minY = co[1]; if (co[1] > maxY) maxY = co[1]; } else co.forEach(rec); })(geom.coordinates);
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}
// 제거 대상? = 아메리카 중심 + BORDERPRECISION 1(대략/원주민 추정)
function shouldDrop(feature) {
  if (!DROP_AMERICAS_PREC1 || !feature.geometry) return false;
  const prec = parseInt(feature.properties?.BORDERPRECISION, 10);
  if (prec !== 1) return false;
  const [lng, lat] = bboxCenter(feature.geometry);
  return lng >= AMERICAS_LNG[0] && lng <= AMERICAS_LNG[1] && lat >= AMERICAS_LAT[0] && lat <= AMERICAS_LAT[1];
}

// 점-선분 수직거리 제곱 (경위도 평면 근사)
function sqSegDist(p, a, b) {
  let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x; dy = p[1] - y;
  return dx * dx + dy * dy;
}
// Douglas–Peucker (반복 구현)
function douglasPeucker(pts, eps) {
  if (pts.length <= 2) return pts;
  const sq = eps * eps, keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxd = 0, idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(pts[i], pts[first], pts[last]);
      if (d > maxd) { maxd = d; idx = i; }
    }
    if (maxd > sq && idx !== -1) { keep[idx] = 1; stack.push([first, idx], [idx, last]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function dedupe(pts) {
  const out = [];
  for (const p of pts) { const l = out[out.length - 1]; if (!l || l[0] !== p[0] || l[1] !== p[1]) out.push(p); }
  return out;
}
function roundRing(ring) { return ring.map(([x, y]) => [round(x), round(y)]); }

// 링(폴리곤 외/내곽): 단순화 후 최소 4점 + 폐합 유지
function simplifyRing(ring) {
  let r = dedupe(roundRing(ring));
  if (r.length > 4) {
    r = douglasPeucker(r, EPSILON);
    if (r.length < 4) r = dedupe(roundRing(ring)); // 너무 줄면 원복(반올림본)
  }
  const f = r[0], l = r[r.length - 1];
  if (f[0] !== l[0] || f[1] !== l[1]) r.push([f[0], f[1]]); // 폐합
  return r;
}
function simplifyLine(line) {
  const r = dedupe(roundRing(line));
  return r.length > 2 ? douglasPeucker(r, EPSILON) : r;
}

function simplifyGeometry(g) {
  if (!g) return g;
  switch (g.type) {
    case "Polygon": g.coordinates = g.coordinates.map(simplifyRing); break;
    case "MultiPolygon": g.coordinates = g.coordinates.map((poly) => poly.map(simplifyRing)); break;
    case "LineString": g.coordinates = simplifyLine(g.coordinates); break;
    case "MultiLineString": g.coordinates = g.coordinates.map(simplifyLine); break;
    case "Point": g.coordinates = [round(g.coordinates[0]), round(g.coordinates[1])]; break;
    case "GeometryCollection": g.geometries = g.geometries.map(simplifyGeometry); break;
  }
  return g;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const files = (await readdir(SRC)).filter((f) => f.endsWith(".geojson"));
  let totalBefore = 0, totalAfter = 0;
  for (const f of files) {
    const srcPath = path.join(SRC, f), raw = await readFile(srcPath, "utf8");
    const geo = JSON.parse(raw);
    const before = (geo.features || []).length;
    geo.features = (geo.features || []).filter((feat) => !shouldDrop(feat)); // 아메리카 원주민(정밀도1) 제거
    const dropped = before - geo.features.length;
    for (const feat of geo.features) feat.geometry = simplifyGeometry(feat.geometry);
    const out = JSON.stringify(geo); // compact
    await writeFile(path.join(OUT, f), out);
    totalBefore += raw.length; totalAfter += out.length;
    console.log(`  ${f.padEnd(26)} ${(raw.length / 1048576).toFixed(2)} → ${(out.length / 1048576).toFixed(2)} MB${dropped ? `  (원주민 ${dropped}개 제거)` : ""}`);
  }
  // index.json 그대로 복사(타임라인 메타)
  try { await copyFile(path.join(SRC, "index.json"), path.join(OUT, "index.json")); } catch {}
  console.log(`\n✓ 경계 ${files.length}개 경량화: ${(totalBefore / 1048576).toFixed(1)} → ${(totalAfter / 1048576).toFixed(1)} MB ` +
    `(${Math.round((1 - totalAfter / totalBefore) * 100)}% 감소, EPSILON=${EPSILON})`);
}
main().catch((e) => { console.error("실패:", e); process.exit(1); });
