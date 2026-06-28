#!/usr/bin/env node
// 기존 data/*.json (events, scenes, borders/index) → content/*.md 로 1회 이관.
// 이후 content/ 가 진실의 원천. 실행:  node scripts/migrate-to-content.mjs
// 이미 있는 파일은 덮어쓰지 않음(--force 로 강제).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serializeDoc, readManifest } from "../lib/content.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.join(ROOT, "content");
const FORCE = process.argv.includes("--force");

const slug = (s) => String(s).trim().replace(/\s+/g, "-").replace(/[\/\\:*?"<>|.]/g, "").slice(0, 60);
const eraId = (y) => (y < 0 ? `bc${Math.abs(y)}` : `y${y}`);

async function write(type, id, data, body) {
  const dir = path.join(CONTENT, type);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.md`);
  if (existsSync(file) && !FORCE) { console.log(`  = 건너뜀(이미 있음): ${type}/${id}.md`); return; }
  await writeFile(file, serializeDoc(data, body));
  console.log(`  + ${type}/${id}.md`);
}

async function migrateEvents() {
  const j = JSON.parse(await readFile(path.join(ROOT, "data/events.json"), "utf8"));
  console.log(`사건 ${j.events.length}건`);
  for (const e of j.events) {
    const start = e.start ?? e.year ?? 0;
    const end = e.end ?? e.endYear ?? null;
    const geometry = e.geometry || "point";
    const data = { title: e.title, region: e.region, category: e.category || "", start, end, geometry };
    if (geometry === "point") data.coordinates = e.coordinates || [e.lng, e.lat];
    else if (e.waypoints) data.waypoints = e.waypoints;
    else data.coordinates = e.coordinates;
    if (e.animate) data.animate = true;
    if (e.sceneId) data.sceneId = e.sceneId;
    const id = e.id || slug(e.title);
    await write("events", id, data, e.description || "");
  }
}

async function migrateScenes() {
  const j = JSON.parse(await readFile(path.join(ROOT, "data/scenes.json"), "utf8"));
  console.log(`장면 ${j.scenes.length}개`);
  for (const s of j.scenes) {
    const data = { title: s.title, start: s.start, end: s.end, step: s.step || 1,
      borderYear: s.borderYear, bounds: s.bounds };
    await write("scenes", s.id, data, s.description || "");
  }
}

async function migrateEras() {
  const j = JSON.parse(await readFile(path.join(ROOT, "data/borders-src/index.json"), "utf8"));
  console.log(`시대 ${j.years.length}개`);
  for (const y of j.years) {
    const data = { year: y.year, borderFile: y.filename, label: y.label || "" };
    const body = (y.countries?.length)
      ? `이 시대에 표시되는 주요 정치체: ${y.countries.slice(0, 30).join(", ")}${y.countries.length > 30 ? " 등" : ""}.`
      : "";
    await write("eras", eraId(y.year), data, body);
  }
}

async function main() {
  console.log("→ content/ 로 이관 시작" + (FORCE ? " (강제 덮어쓰기)" : ""));
  await migrateEvents();
  await migrateScenes();
  await migrateEras();
  const man = await readManifest(CONTENT);
  await writeFile(path.join(CONTENT, "manifest.json"), JSON.stringify(man, null, 2));
  console.log(`\n✓ 완료. manifest.json 생성: 사건 ${man.events.length} · 장면 ${man.scenes.length} · 시대 ${man.eras.length}`);
}
main().catch((e) => { console.error("실패:", e); process.exit(1); });
