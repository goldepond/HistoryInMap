// 콘텐츠 라이브러리 — 프론트매터(.md) 파싱/직렬화 + 매니페스트 빌더
// 서버(server.mjs)와 스크립트(scripts/*)가 공유. 외부 의존성 0.
//
// 파일 형식:
//   ---
//   key: 값            (값은 JSON으로 파싱 시도 → 실패하면 문자열. 한글 문자열은 따옴표 없이 그대로)
//   coordinates: [[1,2],[3,4]]   (배열/객체는 인라인 JSON)
//   ---
//   여기에 본문 마크다운...

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const FM = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

export function parseDoc(text) {
  const m = FM.exec(text);
  if (!m) return { data: {}, body: (text || "").trim() };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    data[key] = parseVal(raw);
  }
  return { data, body: (m[2] || "").trim() };
}

function parseVal(s) {
  if (s === "") return "";
  try { return JSON.parse(s); } catch { return s; }
}

export function serializeDoc(data, body = "") {
  const lines = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    lines.push(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
  return `---\n${lines.join("\n")}\n---\n\n${(body || "").trim()}\n`;
}

const TYPES = ["events", "scenes", "eras"];

// content/ 아래 모든 .md 를 재귀적으로 수집 (폴더 구조는 자유 — 사람이 사건별로 정리)
async function walkMd(dir) {
  const out = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walkMd(p));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

// 타입은 '폴더'가 아니라 '프론트매터 내용'으로 판별. kind: 로 명시도 가능.
function classify(data) {
  if (data.kind) return data.kind;                 // 명시 우선 (event|scene|era)
  if (data.borderFile !== undefined) return "era"; // 시대 = year + borderFile
  if (data.bounds !== undefined) return "scene";   // 장면 = bounds(지도 범위)
  return "event";                                  // 그 외 = 사건(point/route/area)
}

export async function readManifest(contentDir) {
  const out = { events: [], scenes: [], eras: [] };
  const seen = new Map(); // id(=파일명) → 경로. 중복이면 경고(id는 전역 유일해야 함)
  for (const file of await walkMd(contentDir)) {
    const text = await readFile(file, "utf8");
    const { data, body } = parseDoc(text);
    const id = path.basename(file).replace(/\.md$/, "");
    if (seen.has(id)) console.warn(`[content] 중복 id '${id}': ${seen.get(id)} ↔ ${file}`);
    seen.set(id, file);
    const kind = classify(data);
    const bucket = kind === "era" ? "eras" : kind === "scene" ? "scenes" : "events";
    out[bucket].push({ id, ...data, body });
  }
  out.events.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  out.scenes.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  out.eras.sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
  return out;
}

export const CONTENT_TYPES = TYPES;
export const idOk = (s) => /^[a-z0-9가-힣_-]+$/i.test(s);
