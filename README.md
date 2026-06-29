# 📡 실시간 블로그 키워드 레이더

지금 한국에서 뜨는 인기 키워드를 자동으로 잡아, **블로그·뉴스 발행량**과 **상위 노출 글**을
**10분마다** 분석해서 보여주는 GitHub Pages 사이트입니다.

- **인기 키워드**: 구글 트렌드(한국) — API 키 불필요
- **블로그/뉴스 분석**: 네이버 검색 API — 무료 키 필요
- **자동 갱신**: GitHub Actions가 10분마다 데이터 수집 → `data/data.json` 갱신
- **호스팅**: GitHub Pages (정적 사이트, 무료)

> ⚠️ "평균 조회수"는 네이버·구글이 외부에 공개하지 않아 가져올 수 없습니다.
> 대신 **오늘 발행 글 수(지금 핫한지)**, **블로그/뉴스 누적 발행량**, **상위 노출 글**을 보여줍니다.

---

## 화면에 나오는 지표

| 지표 | 의미 |
|------|------|
| **오늘 발행** | 최근 100건 중 오늘 올라온 블로그 글 수 → "지금 많이 올라오는지" |
| **블로그 누적** | 네이버 블로그 전체 검색 결과 수 |
| **뉴스 누적** | 네이버 뉴스 전체 검색 결과 수 |
| **블로그 상위 노출** | 네이버 정확도순 상위 글 (=상위 노출 글) |
| **최신 뉴스** | 가장 최근 뉴스 |
| **네이버/구글 순위 확인** | 클릭하면 실제 검색 결과 페이지로 이동해 순위 직접 확인 |

---

## 배포 방법 (처음 1번만, 약 10분)

### 1단계 — 네이버 검색 API 키 발급 (무료)
1. https://developers.naver.com/apps/#/register 접속 (네이버 로그인)
2. **애플리케이션 이름**: 아무거나 (예: `keyword-radar`)
3. **사용 API**: `검색` 선택
4. **환경 추가**: `WEB 설정` → 서비스 URL에 아무 주소 (예: `https://example.com`)
5. 등록하면 **Client ID**와 **Client Secret**이 나옵니다. (둘 다 복사해두기)

### 2단계 — GitHub 저장소에 올리기
1. https://github.com/new 에서 새 저장소 생성 (예: `keyword-radar`, **Public**)
2. 이 폴더의 파일 전체를 그 저장소에 올립니다.
   - 깃을 쓸 줄 알면: 아래 "깃 명령어" 참고
   - 모르면: GitHub 저장소 페이지의 **Add file → Upload files** 로 폴더째 드래그

### 3단계 — 네이버 키를 GitHub 비밀값으로 등록
저장소 → **Settings → Secrets and variables → Actions → New repository secret**
- 이름 `NAVER_CLIENT_ID`, 값 = 1단계의 Client ID
- 이름 `NAVER_CLIENT_SECRET`, 값 = 1단계의 Client Secret

> 키를 안 넣으면 사이트는 **데모(가짜) 데이터**로 작동합니다. 화면 상단에 "데모 데이터"라고 표시돼요.

### 4단계 — GitHub Pages 켜기
저장소 → **Settings → Pages**
- **Source**: `Deploy from a branch`
- **Branch**: `main` / `/ (root)` 선택 → Save
- 잠시 뒤 `https://<내아이디>.github.io/<저장소이름>/` 주소가 생깁니다.

### 5단계 — 자동 갱신 시작
저장소 → **Actions** 탭 → `키워드 데이터 갱신` 워크플로 선택 → **Run workflow** 한 번 눌러 첫 데이터 생성.
이후로는 10분마다 자동 실행됩니다.

---

## 깃 명령어 (2단계를 명령어로 하려면)

```bash
git init
git add .
git commit -m "최초 커밋: 키워드 레이더"
git branch -M main
git remote add origin https://github.com/<내아이디>/<저장소이름>.git
git push -u origin main
```

---

## 로컬에서 미리 보기

```bash
# 데모 데이터로 data.json 생성
node scripts/fetch.mjs

# (선택) 네이버 키로 실데이터 생성 — PowerShell
$env:NAVER_CLIENT_ID="발급받은ID"; $env:NAVER_CLIENT_SECRET="발급받은SECRET"; node scripts/fetch.mjs

# 간단 서버로 열기 (Python 있을 때)
python -m http.server 8000
# 브라우저에서 http://localhost:8000
```

> `index.html`을 파일로 바로 열면 브라우저 보안 때문에 `data.json` 로딩이 막힐 수 있어요.
> 위처럼 간단 서버로 여세요.

---

## 자주 묻는 질문

**Q. 10분이 너무 잦아요/뜸해요.**
`.github/workflows/update.yml`의 `cron: "*/10 * * * *"`를 바꾸세요. (`*/30` = 30분)
참고로 GitHub Actions 무료 cron은 5분 미만은 지원하지 않고, 트래픽이 몰리면 몇 분 지연될 수 있습니다.

**Q. 추적 키워드를 내가 정하고 싶어요.**
지금은 구글 트렌드 자동입니다. 고정 키워드로 바꾸려면 `scripts/fetch.mjs`의 `getTrendingKeywords()`를
원하는 키워드 배열로 교체하면 됩니다. (원하시면 그 버전도 만들어 드릴 수 있어요.)

**Q. 구글 검색 순위도 자동으로 보고 싶어요.**
구글 Custom Search API 키가 추가로 필요합니다. 지금은 "구글 순위 확인" 버튼으로 직접 확인하게 해뒀어요.

**Q. 공감/댓글 수는 왜 없나요?**
네이버 검색 API가 그 값을 제공하지 않습니다. 글 하나하나를 별도로 크롤링해야 하는데, 대량 크롤링은
차단·약관 문제가 있어 기본에서는 빼뒀습니다.
