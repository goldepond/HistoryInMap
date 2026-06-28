#!/usr/bin/env node
// 로컬 미리보기용 정적 서버 (Node 내장 모듈만, 외부 의존성 0).
// 사이트는 순수 정적입니다 — 이 서버는 fetch()가 file://에서 막히는 걸 피하기 위한 로컬 확인용일 뿐.
// 배포는 GitHub Pages가 담당합니다(편집/저장 API 없음).
//
// 실행:  node server.mjs   (또는  npm start)   ·   포트: PORT(기본 8080)
// 먼저 `npm run build`로 content/manifest.json 과 data/borders/ 를 생성하세요.

import http from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".geojson": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  if (req.method !== "GET") { res.writeHead(405); return res.end("Method Not Allowed"); }
  let rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (rel === "/") rel = "/index.html";
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) { res.writeHead(403); return res.end("Forbidden"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
    createReadStream(filePath).pipe(res);
  } catch { res.writeHead(404); res.end("Not Found"); }
});

server.listen(PORT, "0.0.0.0", () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((n) => n && n.family === "IPv4" && !n.internal);
  console.log(`\n  시대로 보는 세계사 지도 — 로컬 미리보기 서버`);
  console.log(`  ▶ http://localhost:${PORT}` + (lan ? `   ·   http://${lan.address}:${PORT}` : ""));
  console.log(`  (빌드 안 했다면: npm run build)  ·  종료: Ctrl + C\n`);
});
