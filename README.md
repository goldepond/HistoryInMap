# 시대로 보는 세계사 지도 🗺️

연도(시대)를 기준으로 세계사를 정리하는 **지도 중심 반응형 정적 웹사이트**입니다.
같은 시대 **유럽·남미·동아시아** 등의 사건을 병렬 비교하고, **콜럼버스 항해·카이사르 원정** 같은 이동 경로까지 지도 위에 그립니다.
모든 콘텐츠(시대·장면·사건)는 **`content/` 아래 마크다운(.md) 파일**로 관리합니다 — 위키처럼 글을 쓰고, **git에 push하면 자동 배포**됩니다.

> 초기 컨셉/작업 지시서는 [docs/CONCEPT.md](docs/CONCEPT.md) 를 보세요.

## ✨ 주요 기능

- **2단계 타임라인** — 전 세계 10년 단위 / **장면(Scene)** 진입 시 지역 포커스 + 연 단위
- **정확한 지형** — Natural Earth 물리 지도(해안선·강·호수), 줌인 시 50m 자동 전환
- **사건 3종 + 애니메이션** — 지점·경로(▶ 재생)·영역, 클릭 시 마크다운 상세
- **지역 병렬 비교 패널** — 같은 시대의 여러 지역을 동시에
- **순수 정적 · 빠름** — 런타임 서버/네트워크 호출 없음. 캔버스 렌더링 + 빌드 시 경계 경량화로 가볍게 동작

## 🧩 콘텐츠 모델 — `content/*.md`

각 엔티티가 **파일 하나**입니다. 상단 `--- … ---` 는 메타데이터, 그 아래는 마크다운 본문입니다.

```
content/
  events/<id>.md     # 사건 (지점/경로/영역)
  scenes/<id>.md     # 지역 포커스 장면
  eras/<id>.md       # 시대(타임라인 눈금) = 연도 + 국경파일 + 라벨
  manifest.json      # ★ 빌드 산출물 (위 .md들을 모은 색인 — 직접 편집 금지)
```

좌표는 **GeoJSON 순서 `[경도(lng), 위도(lat)]`** 입니다.

**사건 — 지점** (`content/events/granada.md`)
```markdown
---
title: 그라나다 함락
region: 유럽
category: 정치
start: 1492
end: 
geometry: point
coordinates: [-3.6, 37.18]
---

이베리아 반도의 마지막 이슬람 왕국 그라나다가 항복하며 **레콩키스타**가 완성되었다.

## 의의
같은 해 콜럼버스 후원으로 이어진다.
```

**사건 — 경로** (`waypoints` = 순서 있는 경유지, `animate: true` 면 ▶ 재생)
```markdown
---
title: 콜럼버스 1차 항해
region: 남미
geometry: route
start: 1492
end: 1493
animate: true
sceneId: columbus
waypoints: [{"name":"팔로스 출항","lng":-6.9,"lat":37.23,"date":"1492-08-03"},{"name":"산살바도르","lng":-74.5,"lat":24.0,"date":"1492-10-12"}]
---
본문 마크다운…
```

**사건 — 영역** : `geometry: area`, `coordinates: [[ [lng,lat], … ]]` (폴리곤 링)

**시대(era)** (`content/eras/y1492.md`) — 타임라인 눈금 하나
```markdown
---
year: 1492
borderFile: world_1492.geojson
label: 1492년 (대항해시대)
---
이 시대에 대한 설명(선택).
```

**장면(scene)** (`content/scenes/columbus.md`) — 지역 포커스
```markdown
---
title: 대항해시대 — 콜럼버스 1차 항해
start: 1492
end: 1493
step: 1
borderYear: 1492
bounds: [[10, -85], [42, 0]]
---
설명. bounds 는 [[남,서],[북,동]] 위경도.
```

> 메타 값은 **JSON으로 파싱 시도 후 실패하면 문자열**입니다. 숫자/불리언/배열은 그대로(`start: 1492`, `bounds: [[..]]`), 한글 문자열은 따옴표 없이 적으면 됩니다.

## ✍️ 콘텐츠 추가·수정 (git 워크플로)

1. `content/` 아래 `.md` 파일을 **에디터로 새로 만들거나 고칩니다** (사건·시대·장면 모두).
2. **commit & push** (main 브랜치).
3. **GitHub Actions가 자동으로** `content/manifest.json` 과 경량 경계를 빌드하고 GitHub Pages로 배포합니다.

→ `manifest.json` 은 빌드 산출물이라 **직접 만지지 않고, 커밋도 하지 않습니다**(자동 생성).

### 최초 1회 설정 (GitHub Pages)
저장소 **Settings → Pages → Build and deployment → Source = "GitHub Actions"** 로 지정하면 끝.
이후 push할 때마다 `https://goldepond.github.io/HistoryInMap/` 가 갱신됩니다.

## 🖥 로컬에서 미리보기

`fetch()` 로 파일을 읽으므로 `file://` 로 열면 안 됩니다. 먼저 빌드한 뒤 정적 서버로 띄웁니다.

```bash
npm run build        # content/manifest.json + data/borders/(경량) 생성
npm start            # http://localhost:8080  (또는: npx serve .)
```

> `npm run build` = `build:borders`(경계 경량화) + `build:manifest`(매니페스트 생성). 둘 다 Node 내장 모듈만 사용.

## ⚙️ 빌드 파이프라인 & 속도 최적화

- **경계 경량화** — `data/borders-src/`(원본) → `data/borders/`(표시용)로 좌표 단순화(Douglas–Peucker + 3자리 반올림 + compact JSON). 약 **70% 용량 감소**(예: `world_1492` 3.8MB → ~1.2MB). 강도는 [scripts/build-borders.mjs](scripts/build-borders.mjs) 상단 `EPSILON` 으로 조정.
- **캔버스 렌더링** — 국경·지형을 SVG 대신 캔버스에 그려 팬/줌이 매끄러움.
- **레이어 캐시 + 스크럽 디바운스** — 본 시대는 즉시 재표시, 슬라이더를 빠르게 끌 때 무거운 파일 연속 로드 방지.

## 📁 구조

```
HistoryProject/
├─ index.html · css/style.css · js/app.js   # 정적 사이트(읽기 전용)
├─ content/                # ★ 콘텐츠 원천 (.md) — git 관리
│  ├─ events/ scenes/ eras/
│  └─ manifest.json        # 빌드 산출물(.gitignore)
├─ data/
│  ├─ basemap/             # Natural Earth 지형 (110m/50m)
│  ├─ borders-src/         # 국경 원본 GeoJSON + index.json  (git 관리)
│  └─ borders/             # 경량화된 표시용 (빌드 산출물, .gitignore)
├─ vendor/{leaflet,marked}/   # 로컬 번들 라이브러리
├─ lib/content.mjs         # 프론트매터 파서 + 매니페스트 빌더
├─ scripts/
│  ├─ build-borders.mjs    # 경계 경량화
│  ├─ build-manifest.mjs   # 매니페스트 생성
│  └─ fetch-borders.mjs    # 국경 원본 받기(→ borders-src)
├─ server.mjs              # 로컬 미리보기용 정적 서버
├─ .github/workflows/deploy.yml   # CI: 빌드 + Pages 배포
└─ docs/CONCEPT.md
```

## 🗂️ 국경 데이터셋 확장

```bash
node scripts/fetch-borders.mjs            # 원본을 data/borders-src/ 로 받음(index.json 갱신)
node scripts/migrate-to-content.mjs       # 새 연도를 content/eras/ 로 추가(선택)
npm run build                             # 경량 경계 + 매니페스트 재생성
```

## 📜 데이터 출처 & 라이선스

| 항목 | 출처 | 라이선스 |
| --- | --- | --- |
| 시대별 국경 | [aourednik/historical-basemaps](https://github.com/aourednik/historical-basemaps) | **GPL-3.0** |
| 물리 지형 | [Natural Earth](https://www.naturalearthdata.com/) (via [martynafford](https://github.com/martynafford/natural-earth-geojson)) | **Public Domain** |
| 지도 렌더링 | [Leaflet](https://leafletjs.com/) | BSD-2-Clause |
| 마크다운 | [marked](https://github.com/markedjs/marked) | MIT |
| 사건/문서 | 본 프로젝트 | 자유 |

국경 속성: `NAME`, `SUBJECTO`(종주국), `PARTOF`(문화권), `BORDERPRECISION`(1=대략·2=보통·3=확정) · 좌표계 WGS84(EPSG:4326).
GPL-3.0 데이터를 사용하므로 **본 저장소도 GPL-3.0**([LICENSE](LICENSE)). 국경을 수정·재배포하면 동일 라이선스로 공개해야 합니다.

> ⚠ 마크다운 본문은 정화(sanitize)하지 않습니다(개인용). 신뢰할 수 없는 기여가 가능한 공개 환경에서는 HTML 살균을 추가하세요.

## ⚠️ 주의

일부 시대의 국경·경로는 학술적으로 불확실합니다. **참고용**이며 **학술 인용 전 교차검증**이 필요합니다.
