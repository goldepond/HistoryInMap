#!/usr/bin/env node
// 전체 경계 데이터셋을 historical-basemaps에서 내려받아 data/borders/ 에 벤더링하고
// 타임라인을 구동하는 index.json 을 재생성한다.
//
// 사용법:
//   node scripts/fetch-borders.mjs           # 모든 시점 다운로드
//   node scripts/fetch-borders.mjs --since -2000 --until 2010
//
// 의존성 없음 (Node 18+ 내장 fetch 사용).

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data", "borders");
const RAW = "https://raw.githubusercontent.com/aourednik/historical-basemaps/master";

// CLI 옵션
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
};
const SINCE = opt("--since", -Infinity);
const UNTIL = opt("--until", Infinity);

// world_<...>.geojson 파일명에서 연도 추출
function yearFromFilename(fn) {
  const m = fn.match(/^world_(bc)?(\d+)\.geojson$/);
  if (!m) return null;
  const n = parseInt(m[2], 10);
  return m[1] ? -n : n;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log("• 원본 index.json 가져오는 중…");
  const srcIndex = await (await fetch(`${RAW}/index.json`)).json();
  const entries = (srcIndex.years || [])
    .map((y) => ({ year: y.year, filename: y.filename, countries: y.countries || [] }))
    .filter((y) => y.filename && y.year >= SINCE && y.year <= UNTIL)
    .sort((a, b) => a.year - b.year);

  console.log(`• 대상 시점 ${entries.length}개 (${SINCE}~${UNTIL})`);

  const kept = [];
  for (const e of entries) {
    const dest = path.join(OUT_DIR, e.filename);
    if (existsSync(dest)) {
      console.log(`  = 이미 있음: ${e.filename}`);
    } else {
      process.stdout.write(`  ↓ ${e.filename} … `);
      const res = await fetch(`${RAW}/geojson/${e.filename}`);
      if (!res.ok) {
        console.log(`건너뜀 (HTTP ${res.status})`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(dest, buf);
      console.log(`${(buf.length / 1024 / 1024).toFixed(2)} MB`);
    }
    // featureCount 보강
    let featureCount = null;
    try {
      const geo = JSON.parse(await readFile(dest, "utf8"));
      featureCount = geo.features?.length ?? null;
    } catch {}
    kept.push({ year: e.year, filename: e.filename, featureCount, countries: e.countries });
  }

  const index = {
    source: "https://github.com/aourednik/historical-basemaps",
    license: "GPL-3.0",
    note: "fetch-borders.mjs 로 생성됨.",
    years: kept,
  };
  await writeFile(path.join(OUT_DIR, "index.json"), JSON.stringify(index, null, 2));
  console.log(`\n✓ 완료: ${kept.length}개 시점, index.json 갱신됨.`);
}

main().catch((err) => {
  console.error("실패:", err.message);
  process.exit(1);
});
