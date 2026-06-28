# 시대로 보는 세계사 지도 🗺️

연도(시대)를 기준으로 세계사를 정리하는 **지도 중심 반응형 정적 웹사이트**입니다.
같은 시대 **유럽·남미·동아시아** 등의 사건을 병렬 비교하고, **콜럼버스 항해·카이사르 원정** 같은 이동 경로까지 지도 위에 그립니다.
모든 콘텐츠(시대·장면·사건)는 **`content/` 아래 마크다운(.md) 파일**로 관리합니다 — 위키처럼 글을 쓰고, **git에 push하면 자동 배포**됩니다.

> 초기 컨셉/작업 지시서는 [docs/CONCEPT.md](docs/CONCEPT.md) 를 보세요.

## ✨ 주요 기능

- **2단계 타임라인** — 전 세계 10년 단위 / **장면(Scene)** 진입 시 지역 포커스 + 연 단위
- **정확한 지형** — Natural Earth 물리 지도(해안선·강·호수), 줌인 시 50m 자동 전환
- **사건 3종** — 지점·경로·영역, 클릭 시 마크다운 상세. 장면 안에서 경로는 타임라인을 따라 시간순으로 진행
- **지역 병렬 비교 패널** — 같은 시대의 여러 지역을 동시에
- **순수 정적 · 빠름** — 런타임 서버/네트워크 호출 없음. 캔버스 렌더링 + 빌드 시 경계 경량화로 가볍게 동작

## 🧩 콘텐츠 모델 — `content/*.md`

각 엔티티가 **파일 하나**입니다. 상단 `--- … ---` 는 메타데이터, 그 아래는 마크다운 본문입니다.

**폴더는 자유, 타입은 파일 내용으로 판별합니다.** `content/` 아래 `.md`는 **어디에 두든**(루트·하위 폴더) 빌드가 재귀적으로 읽고,
프론트매터로 종류를 정합니다: `borderFile` 있으면 **시대**, `bounds` 있으면 **장면**, 그 외는 **사건**. (원하면 `kind: event|scene|era`로 명시)

→ 그래서 **사건(topic) 단위로 정리**합니다. 단편 사건은 파일 하나, 큰 사건은 장면+경로를 **한 폴더**에:

```
content/
  events/                       # 모든 사건 (단편이든 큰 사건이든)
    1492-granada.md             #   단편 사건 = 파일 하나
    bc323-alexander.md
    ... (단편 사건들)
    bc58-gallic-wars/           #   큰 사건 = 폴더 (장면 + 경로 같이)
      bc58-gallic-wars.md         (장면)
      bc58-gallic-wars-route.md   (경로)
    1492-columbus/
      1492-columbus.md            (장면)
      1492-columbus-route.md      (경로)
  eras/                         # 타임라인 눈금(인프라) — 14개
    y1492.md ...
  manifest.json                 # ★ 빌드 산출물 (자동 생성 — 직접 편집 금지)
```

> **네이밍 컨벤션: `<연도>-<주제>`** (지역코드 없음). 연도는 BC `bc<n>`·AD `<n>`, 주제는 짧은 영문 kebab.
> 예: `1492-granada` · `bc323-alexander` · `2010-arabspring`. 큰 사건도 동일 — 폴더 `bc58-gallic-wars/`, 그 안 장면 `bc58-gallic-wars.md` + 경로 `bc58-gallic-wars-route.md`.
> (강제 규칙은 **"파일명=id, content/ 전체에서 유일 + 안전한 문자(영문·숫자·한글·`-`·`_`)"** 뿐. 파일명은 데이터로 안 읽히니 컨벤션은 정리·정렬용입니다.)

> **id = 파일명**(폴더 무관). `sceneId`는 그 파일명을 가리킵니다. 폴더 이름·위치는 **사람이 정리하는 용도**일 뿐 시스템 동작에 영향 없음 — 언제든 자유롭게 옮겨도 됩니다.

### 구조: '포함'이 아니라 '참조'

같은 폴더에 있어도 장면이 사건을 **소유**하는 건 아닙니다. 연결은 **참조**입니다.

```
사건(event) = point | route | area 중 "하나"
              └ route(경로)는 내부에 waypoints(지점들)를 품음
장면(scene)  = "지도 시점 + 타임라인 범위"만 정의
시대(era)    = 타임라인 눈금 1개 = 연도 + 국경파일

연결은 '포함'이 아니라 '참조':
  사건 ──sceneId────▶ 장면          (선택; 여러 사건이 한 장면을 가리킬 수 있음)
  장면 ──borderYear─▶ 국경 스냅샷
  시대 ──borderFile─▶ 국경 파일

장면을 켜면 → sceneId가 그 장면이거나, 장면 bounds 안에 있는 사건이 표시됨.
```

- ✅ `route`(경로) **안에** `waypoints`(지점들) — 맞음
- ✅ `point`(지점) **단독 사건** — 맞음 (장면 없이도 존재)
- ✅ 큰 사건은 장면+경로를 **한 폴더**에 두기 — 권장(정리용)
- ❌ `scene`(장면)이 `route`·`point`를 **'소유'하지는 않음** — `sceneId`로 **참조**할 뿐

좌표는 **GeoJSON 순서 `[경도(lng), 위도(lat)]`** 입니다.

**사건 — 지점** (`content/events/1492-granada.md`)
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

**사건 — 경로** (`waypoints` = 순서 있는 경유지. 장면 안에서 타임라인을 움직이면 경유지 `date`에 맞춰 시간순으로 진행)
```markdown
---
title: 콜럼버스 1차 항해
region: 남미
geometry: route
start: 1492
end: 1493
sceneId: 1492-columbus
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

**장면(scene)** (`content/events/1492-columbus/1492-columbus.md`) — 지역 포커스
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

## 📋 필드 레퍼런스 — 무엇을 건드려도 되나

위키처럼 확장하기 전에 이것만 알면 됩니다.

### 🚫 절대 직접 수정 금지 (자동 생성물)
| 경로 | 정체 |
| --- | --- |
| `content/manifest.json` | `.md`들을 모아 빌드한 색인. 손대도 다음 빌드에 덮어써짐 (gitignore) |
| `data/borders/` | `data/borders-src/`를 경량화해 만든 표시용. 빌드 산출물 (gitignore) |

→ 이 둘은 `npm run build`(또는 CI)가 만듭니다. **편집은 항상 아래 "원천 파일"에서.**

### ✏️ 수정하는 원천 파일
- `content/**/*.md` — **여기서 자유롭게 추가·수정·삭제** (폴더 구조 자유, 타입은 내용으로 판별)
- `data/borders-src/*.geojson` — **새 시대 국경을 추가할 때만**

### 공통 규칙 (자주 실수하는 것)
- **좌표는 항상 `[경도(lng), 위도(lat)]` 순서** — 구글지도(위도,경도)와 **반대**입니다.
- 프론트매터 값: 유효한 JSON이면 그대로(숫자·배열·`true`/`false`), 아니면 문자열. 한글은 따옴표 없이.
- **연도: BC는 음수**(`기원전 58년` → `-58`), AD는 양수(`-50`은 BC 50).
- **파일명 = `id`**. 영문/숫자/한글/`-`/`_` 가능, 폴더 안에서 유일하게.

---

### 🟦 사건 — `content/…/<id>.md` (어디에 둬도 됨)
| 필드 | 필수 | 의미 / 허용값 | 수정 |
| --- | :---: | --- | --- |
| `title` | ✅ | 제목(마커·패널·팝업) | 자유 |
| `region` | ✅ | 패널 분류 + 마커 **색**. 색 지정된 6종: `유럽`·`남미`·`동아시아`·`서아시아`·`아프리카`·`북미`. 다른 이름도 동작하나 회색 | 자유(6종 권장) |
| `category` | ⬜ | 라벨용 꼬리표(`전쟁`·`탐험`·`정치`·`문화`·`경제` 등 아무거나) | 자유 |
| `start` | ✅ | 시작 연도 | 자유(숫자) |
| `end` | ⬜ | 종료 연도. 비우면(또는 생략) **단일 시점** | 자유(숫자/빈값) |
| `geometry` | ✅ | `point` / `route` / `area` 중 하나 | **형식 지킬 것** |
| `coordinates` 또는 `waypoints` | ✅ | 도형 데이터(아래) | **형식 지킬 것** |
| `sceneId` | ⬜ | 특정 장면에 묶기. **장면 `id`와 정확히 일치**해야 함(현재: `bc58-gallic-wars`·`1492-columbus`·`1490-discovery-age`) | 일치 필요 |
| (본문) | ⬜ | `---` 아래 **마크다운 설명** (길게 써도 됨) | 자유 |

**geometry별 좌표 형식**
```yaml
# 지점
geometry: point
coordinates: [경도, 위도]            # 예: [-3.6, 37.18]

# 경로 (순서 있는 경유지 — name/date 포함 권장)
geometry: route
waypoints: [{"name":"제네바","lng":6.14,"lat":46.2,"date":"BC 58"}, {...}]
#   또는 좌표만:  coordinates: [[경도,위도], [경도,위도], ...]

# 영역 (폴리곤 한 고리 — 첫 점 = 끝 점으로 닫기)
geometry: area
coordinates: [[ [경도,위도], [경도,위도], ..., [첫경도,첫위도] ]]
```
- `waypoints[].date` 는 **경로의 시간 진행**을 결정합니다(장면에서 타임라인이 그 연도에 닿으면 거기까지 진행). 인식 형식: `"BC 58"`, `"기원전 58"`, `"AD 100"`, `"1492-08-03"`, `"1492"`.
- `animate` 필드는 **더 이상 쓰이지 않습니다**(있어도 무시).

### 🎬 장면 — `content/events/<큰사건>/<id>.md` (경로와 같은 폴더 권장)
| 필드 | 필수 | 의미 / 허용값 | 수정 |
| --- | :---: | --- | --- |
| `title` | ✅ | 드롭다운 라벨 + 캡션 | 자유 |
| `start` / `end` | ✅ | 장면 타임라인 범위(연도) | 자유(숫자) |
| `step` | ⬜ | 슬라이더 간격(년), 기본 `1` | 자유(숫자) |
| `borderYear` | ✅ | 배경에 깔 **국경 시대**. **아무 연도나 OK → 가장 가까운 스냅샷으로 자동 스냅.** 아래 표의 연도를 쓰면 정확히 그게 나옴 | **자유**(숫자) |
| `bounds` | ✅ | 지도 보기 범위 `[[남, 서], [북, 동]]` 위경도 | **형식 지킬 것** |
| (본문) | ⬜ | 장면 설명(패널 표시) | 자유 |

### 🕰 시대 — `content/eras/<id>.md` (타임라인 눈금 1개)
| 필드 | 필수 | 의미 / 허용값 | 수정 |
| --- | :---: | --- | --- |
| `year` | ✅ | 이 눈금의 연도(BC 음수) | 자유(숫자) |
| `borderFile` | ✅ | 이 시대에 보여줄 국경 파일. **`data/borders/`에 실제로 있는 파일명**이어야 함(아래 표) | **실제 파일명 필요** |
| `label` | ⬜ | 지도 좌상단 배지에 표시될 이름 | 자유 |
| (본문) | ⬜ | 메모(선택) | 자유 |

### 🗺 사용 가능한 국경 스냅샷 (`borderYear` / `borderFile` 값)
| 연도(year) | borderFile | 라벨 |
| ---: | --- | --- |
| -2000 | `world_bc2000.geojson` | 기원전 2000년 |
| -323 | `world_bc323.geojson` | 기원전 323년 (알렉산드로스 사후) |
| 100 | `world_100.geojson` | 서기 100년 (로마 전성기) |
| 500 | `world_500.geojson` | 500년 |
| 1000 | `world_1000.geojson` | 1000년 |
| 1279 | `world_1279.geojson` | 1279년 (몽골 제국) |
| 1492 | `world_1492.geojson` | 1492년 (대항해시대) |
| 1600 | `world_1600.geojson` | 1600년 |
| 1715 | `world_1715.geojson` | 1715년 |
| 1815 | `world_1815.geojson` | 1815년 (빈 회의) |
| 1900 | `world_1900.geojson` | 1900년 (제국주의) |
| 1914 | `world_1914.geojson` | 1914년 (1차 대전) |
| 1945 | `world_1945.geojson` | 1945년 (2차 대전 종전) |
| 2010 | `world_2010.geojson` | 2010년 (현대) |

> **목록에 없는 시대가 필요하면**: `node scripts/fetch-borders.mjs` 로 원본을 받거나(→ `data/borders-src/`), 직접 GeoJSON을 `data/borders-src/`에 넣고 `npm run build`. 그다음 `content/eras/`에 새 `.md`를 추가하면 타임라인 눈금이 늘어납니다.

### ⚡ 한눈 판단
- **글·숫자·설명만** 고친다 → 마음껏 (`title`·`region`·`start`·`end`·`label`·`bounds`·본문 …)
- **도형·좌표·`sceneId`·`borderFile`** → 형식/참조만 맞추면 OK
- **`manifest.json`·`data/borders/`** → 절대 손대지 말 것(자동 생성)

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

- **경계 경량화** — `data/borders-src/`(원본) → `data/borders/`(표시용)로 좌표 단순화(Douglas–Peucker + 3자리 반올림 + compact JSON). 강도는 [scripts/build-borders.mjs](scripts/build-borders.mjs) 상단 `EPSILON` 으로 조정.
- **아메리카 원주민 추정 경계 제거** — 명나라는 한 덩이인데 1492년 북미만 폴리곤 수백~수천 조각이라 과도 → 빌드 시 **아메리카 영역 + `BORDERPRECISION=1`(대략)** 폴리곤을 제거(미국·식민지 등 정밀도 2~3은 유지). `build-borders.mjs`의 `DROP_AMERICAS_PREC1=false`로 끄면 원래대로. 원본은 `borders-src`에 보존.
- 위 둘을 합쳐 약 **79% 용량 감소**(예: `world_1492` 3.8MB → 0.24MB).
- **캔버스 렌더링** — 국경·지형을 SVG 대신 캔버스에 그려 팬/줌이 매끄러움.
- **레이어 캐시 + 스크럽 디바운스** — 본 시대는 즉시 재표시, 슬라이더를 빠르게 끌 때 무거운 파일 연속 로드 방지.

## 📁 구조

```
HistoryProject/
├─ index.html · css/style.css · js/app.js   # 정적 사이트(읽기 전용)
├─ content/                # ★ 콘텐츠 원천 (.md) — git 관리
│  ├─ events/              #   모든 사건 (단편 .md + 큰사건 폴더[장면+경로])
│  ├─ eras/                #   타임라인 눈금(인프라)
│  └─ manifest.json        #   빌드 산출물(.gitignore)
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

국경 속성: `NAME`, `SUBJECTO`(종주국), `PARTOF`(문화권), `BORDERPRECISION`(제작자의 경계 신뢰도 — 1=대략적 추정 · 3=확실히 기록된 경계 · 2는 거의 안 씀, 다소 주관적) · 좌표계 WGS84(EPSG:4326).
GPL-3.0 데이터를 사용하므로 **본 저장소도 GPL-3.0**([LICENSE](LICENSE)). 국경을 수정·재배포하면 동일 라이선스로 공개해야 합니다.

> ⚠ 마크다운 본문은 정화(sanitize)하지 않습니다(개인용). 신뢰할 수 없는 기여가 가능한 공개 환경에서는 HTML 살균을 추가하세요.

## ⚠️ 주의

일부 시대의 국경·경로는 학술적으로 불확실합니다. **참고용**이며 **학술 인용 전 교차검증**이 필요합니다.
