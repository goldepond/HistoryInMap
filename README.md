# 시대로 보는 세계사 지도 🗺️

연도(시대)를 기준으로 세계사를 정리하는 **지도 중심 반응형 웹사이트**입니다.
같은 시대 **유럽·남미·동아시아** 등의 사건을 병렬 비교하고, **콜럼버스 항해·카이사르 원정** 같은 이동 경로까지 지도 위에 그립니다.
모든 콘텐츠(시대·장면·사건)는 **`content/` 아래 마크다운(.md) 파일**로 관리됩니다 — 위키처럼 글을 쓰고, Terraform처럼 파일로 버전관리합니다.

> 초기 컨셉/작업 지시서는 [docs/CONCEPT.md](docs/CONCEPT.md) 를 보세요.

## ✨ 주요 기능

- **2단계 타임라인** — 전 세계 10년 단위 / **장면(Scene)** 진입 시 지역 포커스 + 연 단위
- **정확한 지형** — Natural Earth 물리 지도(해안선·강·호수), 줌인 시 50m 자동 전환
- **사건 3종 + 애니메이션** — 지점·경로(▶ 재생)·영역
- **지역 병렬 비교 패널** — 같은 시대의 여러 지역을 동시에
- **모든 것이 편집 가능** — **시대·장면·사건**을 마크다운으로 추가·수정·삭제
  - 지도 위에서 도형을 그리면 좌표가 자동으로 채워지고, 본문은 마크다운으로 작성
  - 패널의 ✏ 로 **원문(.md)을 그대로 편집**(위키식), 실시간 미리보기
  - 국경 폴리곤 오류도 드래그로 수정
  - 변경은 서버가 **파일에 즉시 저장**

## 🚀 실행

편집·저장하려면 동봉된 초경량 서버(Node 내장 모듈만, **외부 의존성 0**)로 띄웁니다.

```bash
node server.mjs        # 또는: npm start
```

```
  ▶ 이 컴퓨터:    http://localhost:8080
  ▶ 같은 네트워크:  http://192.168.x.x:8080   (다른 사람도 편집 가능)
```

- 포트 변경: `PORT=3000 node server.mjs`
- ⚠ **인증 없음**(개인용). 신뢰된 네트워크에서만 사용하세요.
- 읽기 전용으로만 볼 거면 정적 호스팅도 가능(아래) — 이때 편집은 ‘.md 다운로드’로 폴백됩니다.

## 🧩 데이터 모델 — `content/*.md`

각 엔티티가 **파일 하나**입니다. 상단 `--- … ---` 는 메타데이터, 그 아래는 마크다운 본문입니다.

```
content/
  events/<id>.md     # 사건 (지점/경로/영역)
  scenes/<id>.md     # 지역 포커스 장면
  eras/<id>.md       # 시대(타임라인 눈금) = 연도 + 국경파일 + 라벨
  manifest.json      # 위 파일들을 모은 캐시(서버가 자동 생성)
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

**사건 — 경로** (`waypoints` 는 순서 있는 경유지, `animate: true` 면 ▶ 재생)
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

**시대(era)** — 타임라인 눈금 하나 (`content/eras/y1492.md`)
```markdown
---
year: 1492
borderFile: world_1492.geojson
label: 1492년 (대항해시대)
---
이 시대에 대한 설명(선택).
```

**장면(scene)** — 지역 포커스 (`content/scenes/columbus.md`)
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

> 메타 값은 **JSON으로 파싱 시도 후 실패하면 문자열**입니다. 즉 숫자/불리언/배열은 그대로(`start: 1492`, `bounds: [[..]]`), 한글 문자열은 따옴표 없이 적으면 됩니다.

## ✍️ 편집하는 두 가지 방법

### 1) 브라우저에서 (위키식)
1. 우상단 **✎ 편집**
2. **새 사건**: 지도 도구로 마커/선/면을 그림 → 원문(.md) 편집기가 열림 → 본문 작성 → **저장**
3. **기존 편집**: 오른쪽 패널·관리 목록의 ✏ → 원문(.md)을 고치고 저장 / 🗑 삭제
4. **시대·장면 추가**: 관리 패널의 🕰/🎬 옆 ＋
5. **국경 수정**: ‘국경 폴리곤 편집’ 체크 → 꼭짓점 드래그 → **이 시대 경계 저장**

→ 전부 `content/` · `data/borders/` 파일에 즉시 저장됩니다.

### 2) 파일로 (Terraform식)
`content/` 아래 `.md` 를 에디터로 직접 만들거나 고친 뒤 브라우저를 새로고침하면 반영됩니다.
git 으로 버전관리·협업하기에 좋습니다. (서버가 켜져 있으면 매니페스트는 자동 갱신됩니다.)

## 🌐 정적 호스팅 배포 (읽기 전용)

저장 서버 없이 GitHub Pages / Cloudflare Pages / Netlify 에 그대로 올릴 수 있습니다(빌드 단계 없음).
이때 사이트는 `content/manifest.json` 을 읽어 **읽기 전용**으로 동작하고, 편집은 ‘.md 다운로드’로만 가능합니다.
공개본을 최신화하려면 `content/` 수정 후 서버를 한 번 켜거나 매니페스트를 재생성하세요.

## 📁 구조

```
HistoryProject/
├─ index.html
├─ server.mjs                 # 콘텐츠 서버 (Node 내장, 의존성 0)
├─ package.json               # npm start
├─ lib/content.mjs            # 프론트매터 파서 + 매니페스트 빌더(서버·스크립트 공용)
├─ css/style.css
├─ js/app.js                  # 지도·타임라인·편집·저장 전부
├─ content/                   # ★ 콘텐츠 원천 (.md)
│  ├─ events/  scenes/  eras/
│  └─ manifest.json
├─ data/
│  ├─ basemap/                # Natural Earth 지형 (110m/50m)
│  └─ borders/                # 시대별 국경 GeoJSON + index.json
├─ vendor/{leaflet,geoman,marked}/   # 로컬 번들 라이브러리
├─ scripts/
│  ├─ fetch-borders.mjs       # 국경 전체 데이터셋 받기
│  └─ migrate-to-content.mjs  # (1회) 구 JSON → content/*.md
└─ docs/CONCEPT.md
```

## 🗂️ 국경 데이터셋 확장

현재 14개 시대가 번들돼 있습니다. 전체로 확장:
```bash
node scripts/fetch-borders.mjs                 # 전체 (data/borders/index.json 갱신)
node scripts/migrate-to-content.mjs            # 새 연도를 content/eras/ 로 추가
```

## 📜 데이터 출처 & 라이선스

| 항목 | 출처 | 라이선스 |
| --- | --- | --- |
| 시대별 국경 | [aourednik/historical-basemaps](https://github.com/aourednik/historical-basemaps) | **GPL-3.0** |
| 물리 지형 | [Natural Earth](https://www.naturalearthdata.com/) (via [martynafford](https://github.com/martynafford/natural-earth-geojson)) | **Public Domain** |
| 지도 렌더링 | [Leaflet](https://leafletjs.com/) | BSD-2-Clause |
| 지도 편집 | [Leaflet-Geoman Free](https://github.com/geoman-io/leaflet-geoman) | MIT |
| 마크다운 | [marked](https://github.com/markedjs/marked) | MIT |
| 사건/문서 | 본 프로젝트 | 자유 |

국경 속성: `NAME`, `SUBJECTO`(종주국), `PARTOF`(문화권), `BORDERPRECISION`(1=대략·2=보통·3=확정) · 좌표계 WGS84(EPSG:4326).
GPL-3.0 데이터를 사용하므로 **본 저장소도 GPL-3.0**([LICENSE](LICENSE)). 국경을 수정·재배포하면 동일 라이선스로 공개해야 합니다.

> ⚠ 마크다운 본문은 정화(sanitize)하지 않습니다(개인용). 신뢰할 수 없는 사람이 쓰는 공개 환경에서는 HTML 살균을 추가하세요.

## ⚠️ 주의

일부 시대의 국경·경로는 학술적으로 불확실합니다. **참고용**이며 **학술 인용 전 교차검증**이 필요합니다.
