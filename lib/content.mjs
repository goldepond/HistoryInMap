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

export async function readManifest(contentDir) {
  const out = { events: [], scenes: [], eras: [] };
  for (const t of TYPES) {
    const dir = path.join(contentDir, t);
    let files = [];
    try { files = (await readdir(dir)).filter((f) => f.endsWith(".md")); } catch { /* 폴더 없음 */ }
    for (const f of files) {
      const text = await readFile(path.join(dir, f), "utf8");
      const { data, body } = parseDoc(text);
      out[t].push({ id: f.replace(/\.md$/, ""), ...data, body });
    }
  }
  out.events.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  out.scenes.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  out.eras.sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
  return out;
}

export const CONTENT_TYPES = TYPES;
export const idOk = (s) => /^[a-z0-9가-힣_-]+$/i.test(s);
