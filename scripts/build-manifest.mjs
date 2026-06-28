#!/usr/bin/env node
// content/*.md → content/manifest.json 생성 (정적 사이트가 읽는 색인).
// .md 를 고친 뒤 실행하거나, CI(빌드)에서 자동 실행. 의존성 0.
//
// 실행:  node scripts/build-manifest.mjs

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readManifest } from "../lib/content.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.join(ROOT, "content");

const man = await readManifest(CONTENT);
await writeFile(path.join(CONTENT, "manifest.json"), JSON.stringify(man, null, 2));
console.log(`✓ manifest.json 생성: 사건 ${man.events.length} · 장면 ${man.scenes.length} · 시대 ${man.eras.length}`);
