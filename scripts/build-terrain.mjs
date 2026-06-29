#!/usr/bin/env node
// 산맥 벡터 생성: Natural Earth 지리구역(50m) 중 'Range/mtn'만 → data/basemap/mountains.geojson
// "산이냐 아니냐"를 한눈에 보여주는 스키매틱용(굵은 색칠). 가벼움·선명·오프라인.
//   실행:  node scripts/build-terrain.mjs

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "basemap", "mountains.geojson");
const SRC = "https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/physical/ne_50m_geography_regions_polys.json";
const EPSILON = 0.08, DECIMALS = 2;

const round = (n) => Math.round(n * 10 ** DECIMALS) / 10 ** DECIMALS;
function sqSegDist(p, a, b) { let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y; if (dx || dy) { const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy); if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; } } dx = p[0] - x; dy = p[1] - y; return dx * dx + dy * dy; }
function dp(pts, eps) { if (pts.length <= 2) return pts; const sq = eps * eps, keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]]; while (st.length) { const [f, l] = st.pop(); let md = 0, idx = -1; for (let i = f + 1; i < l; i++) { const d = sqSegDist(pts[i], pts[f], pts[l]); if (d > md) { md = d; idx = i; } } if (md > sq && idx > -1) { keep[idx] = 1; st.push([f, idx], [idx, l]); } } return pts.filter((_, i) => keep[i]); }
function ringSimp(r) { let o = r.map(([x, y]) => [round(x), round(y)]); if (o.length > 4) o = dp(o, EPSILON); if (o.length < 4) o = r.map(([x, y]) => [round(x), round(y)]); const f = o[0], l = o[o.length - 1]; if (f[0] !== l[0] || f[1] !== l[1]) o.push([f[0], f[1]]); return o; }
function simp(g) { if (!g) return g; if (g.type === "Polygon") g.coordinates = g.coordinates.map(ringSimp); else if (g.type === "MultiPolygon") g.coordinates = g.coordinates.map((p) => p.map(ringSimp)); return g; }

const geo = await (await fetch(SRC)).json();
geo.features = geo.features
  .filter((f) => f.properties.featurecla === "Range/mtn")
  .map((f) => ({ type: "Feature", properties: { name: f.properties.name, scalerank: f.properties.scalerank }, geometry: simp(f.geometry) }));
await mkdir(path.dirname(OUT), { recursive: true });
const out = JSON.stringify(geo);
await writeFile(OUT, out);
console.log(`✓ mountains.geojson: 산맥 ${geo.features.length}개, ${(out.length / 1024).toFixed(0)} KB`);
