#!/usr/bin/env node
// 큰 줄기 벡터 지형도 생성: Natural Earth 지리구역(50m)에서 '지형' 유형만 골라 단순화.
//   → data/basemap/terrain-regions.geojson (산맥·사막·고원·분지·평원 등, 유형별 색칠용)
// 벡터라 어느 줌에서도 선명하고 가벼움. 출력은 정적 커밋물(배포 시 빌드 불필요).
//
// 실행:  node scripts/build-terrain.mjs

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "basemap", "terrain-regions.geojson");
const SRC = "https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/physical/ne_50m_geography_regions_polys.json";

const EPSILON = 0.12;  // 큰 줄기만 → 과감히 단순화
const DECIMALS = 2;
// '지형'으로 칠할 유형만 유지(대륙·섬·해안 라벨 등은 제외)
const KEEP = new Set(["Range/mtn", "Plateau", "Foothills", "Desert", "Basin", "Plain", "Lowland", "Tundra", "Valley", "Delta", "Wetlands", "Gorge"]);

const round = (n) => Math.round(n * 10 ** DECIMALS) / 10 ** DECIMALS;
function sqSegDist(p, a, b) { let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y; if (dx || dy) { const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy); if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; } } dx = p[0] - x; dy = p[1] - y; return dx * dx + dy * dy; }
function dp(pts, eps) { if (pts.length <= 2) return pts; const sq = eps * eps, keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]]; while (st.length) { const [f, l] = st.pop(); let md = 0, idx = -1; for (let i = f + 1; i < l; i++) { const d = sqSegDist(pts[i], pts[f], pts[l]); if (d > md) { md = d; idx = i; } } if (md > sq && idx > -1) { keep[idx] = 1; st.push([f, idx], [idx, l]); } } return pts.filter((_, i) => keep[i]); }
function ringSimp(r) { let o = r.map(([x, y]) => [round(x), round(y)]); if (o.length > 4) o = dp(o, EPSILON); if (o.length < 4) o = r.map(([x, y]) => [round(x), round(y)]); const f = o[0], l = o[o.length - 1]; if (f[0] !== l[0] || f[1] !== l[1]) o.push([f[0], f[1]]); return o; }
function simp(g) { if (!g) return g; if (g.type === "Polygon") g.coordinates = g.coordinates.map(ringSimp); else if (g.type === "MultiPolygon") g.coordinates = g.coordinates.map((p) => p.map(ringSimp)); return g; }

const geo = await (await fetch(SRC)).json();
const before = geo.features.length;
geo.features = geo.features
  .filter((f) => KEEP.has(f.properties.featurecla))
  .map((f) => ({ type: "Feature",
    properties: { featurecla: f.properties.featurecla, name: f.properties.name, scalerank: f.properties.scalerank },
    geometry: simp(f.geometry) }));
await mkdir(path.dirname(OUT), { recursive: true });
const out = JSON.stringify(geo);
await writeFile(OUT, out);
const ranks = {};
geo.features.forEach((f) => { ranks[f.properties.scalerank] = (ranks[f.properties.scalerank] || 0) + 1; });
console.log(`✓ terrain-regions.geojson: ${before}→${geo.features.length}개 지형구역, ${(out.length / 1024).toFixed(0)} KB`);
console.log(`  scalerank 분포(작을수록 큰 지형): ${JSON.stringify(ranks)}`);
