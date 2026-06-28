#!/usr/bin/env node
// 시대로 보는 세계사 지도 — 콘텐츠 서버 (Node 내장 모듈만, 외부 의존성 0)
//   - 정적 파일 서빙
//   - content/*.md (위키/Terraform식) 읽기·쓰기·삭제 API
//   - 국경 GeoJSON 저장 API
//
// 실행:  node server.mjs   (또는  npm start)   ·   포트: PORT(기본 8080)
// ⚠ 인증 없음. 누구나 읽고 쓸 수 있는 개인용 서버입니다. 신뢰된 네트워크에서만 사용하세요.

import http from "node:http";
import { readFile, writeFile, unlink, readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { parseDoc, serializeDoc, readManifest, CONTENT_TYPES, idOk } from "./lib/content.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, "data");
const CONTENT = path.join(ROOT, "content");
const PORT = process.env.PORT || 8080;

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".geojson": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,PUT,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
  res.end(body);
}
const ok = (res, obj) => send(res, 200, JSON.stringify(obj));
const err = (res, code, msg) => send(res, code, JSON.stringify({ error: msg }));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ""; req.on("data", (c) => { d += c; if (d.length > 80e6) reject(new Error("본문 초과")); });
    req.on("end", () => resolve(d)); req.on("error", reject);
  });
}
async function regenManifest() {
  const man = await readManifest(CONTENT);
  await writeFile(path.join(CONTENT, "manifest.json"), JSON.stringify(man, null, 2));
  return man;
}

async function handleApi(req, res, url) {
  const seg = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const body = await readBody(req).catch(() => "");
  let json = {};
  if (body) { try { json = JSON.parse(body); } catch { return err(res, 400, "잘못된 JSON"); } }

  // 콘텐츠 매니페스트
  if (seg[1] === "content" && seg.length === 2 && req.method === "GET")
    return ok(res, await readManifest(CONTENT));

  // 콘텐츠 문서 쓰기/삭제/지오메트리 패치:  /api/content/:type/:id[/geometry]
  if (seg[1] === "content" && seg[2] && seg[3]) {
    const type = seg[2], id = seg[3];
    if (!CONTENT_TYPES.includes(type)) return err(res, 400, "알 수 없는 type");
    if (!idOk(id)) return err(res, 400, "허용되지 않는 id");
    const file = path.join(CONTENT, type, `${id}.md`);

    if (seg[4] === "geometry" && req.method === "PUT") {
      let parsed;
      try { parsed = parseDoc(await readFile(file, "utf8")); } catch { return err(res, 404, "문서 없음"); }
      parsed.data.geometry = json.geometry;
      if (json.geometry === "route" && Array.isArray(json.waypoints)) { parsed.data.waypoints = json.waypoints; delete parsed.data.coordinates; }
      else { parsed.data.coordinates = json.coordinates; delete parsed.data.waypoints; }
      if (json.animate !== undefined) parsed.data.animate = json.animate;
      await writeFile(file, serializeDoc(parsed.data, parsed.body));
      await regenManifest();
      return ok(res, { ok: true });
    }
    if (req.method === "PUT") {
      if (typeof json.raw !== "string") return err(res, 400, "raw 문자열 필요");
      await writeFile(file, json.raw.endsWith("\n") ? json.raw : json.raw + "\n");
      const { data, body: b } = parseDoc(json.raw);
      await regenManifest();
      return ok(res, { ok: true, id, ...data, body: b });
    }
    if (req.method === "DELETE") {
      try { await unlink(file); } catch { return err(res, 404, "문서 없음"); }
      await regenManifest();
      return ok(res, { ok: true, deleted: id });
    }
  }

  // 국경 파일 목록
  if (seg[1] === "borders" && seg.length === 2 && req.method === "GET") {
    let files = [];
    try { files = (await readdir(path.join(DATA, "borders"))).filter((f) => /^world_.*\.geojson$/i.test(f)); } catch {}
    return ok(res, { files });
  }
  // 국경 저장:  /api/borders/<world_xxx.geojson>
  if (seg[1] === "borders" && seg[2] && req.method === "PUT") {
    if (!/^world_[a-z0-9_]+\.geojson$/i.test(seg[2])) return err(res, 400, "허용되지 않는 파일명");
    if (json.type !== "FeatureCollection") return err(res, 400, "FeatureCollection 필요");
    await writeFile(path.join(DATA, "borders", seg[2]), JSON.stringify(json));
    return ok(res, { ok: true, features: json.features?.length ?? 0 });
  }
  return err(res, 404, "알 수 없는 API");
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) return send(res, 403, "Forbidden", "text/plain");
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) return send(res, 403, "Forbidden", "text/plain");
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
    createReadStream(filePath).pipe(res);
  } catch { send(res, 404, "Not Found", "text/plain"); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") return send(res, 204, "");
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (req.method !== "GET") return send(res, 405, "Method Not Allowed", "text/plain");
    return await serveStatic(req, res, url);
  } catch (e) { console.error(e); err(res, 500, e.message); }
});

regenManifest().catch(() => {}); // 부팅 시 매니페스트 최신화
server.listen(PORT, "0.0.0.0", () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((n) => n && n.family === "IPv4" && !n.internal);
  console.log(`\n  시대로 보는 세계사 지도 — 콘텐츠 서버 실행 중`);
  console.log(`  ▶ 이 컴퓨터:    http://localhost:${PORT}`);
  if (lan) console.log(`  ▶ 같은 네트워크: http://${lan.address}:${PORT}  (다른 사람도 편집 가능)`);
  console.log(`  콘텐츠: content/*.md  ·  종료: Ctrl + C\n`);
});
