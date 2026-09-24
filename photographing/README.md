# 포토그래핑 (Photographing)

사진 찍는 사람들이 **함께 출사를 나가고, 비슷한 사람끼리 모여 이야기하고, 나에게 맞는 사진 정보를 얻는** 모임 기반 사진 커뮤니티 앱. 현재 단계: **검증 (1~2주차)**.

> 이 폴더는 `keyword-radar` 저장소와 무관한 별도 프로젝트입니다. 저장소를 따로 만들면 이 폴더째 옮기면 됩니다 (아래 "별도 저장소로 옮기기").

## 폴더 구조

```
photographing/
├── README.md                  ← 이 파일
├── docs/
│   ├── 01-service-plan.md     ← 서비스 플랜 v1.0 (정의, 기능, MVP 범위, 일정, 지표)
│   ├── 02-name-check.md       ← "포토그래핑" 이름·상표 확인 결과와 체크리스트
│   ├── 03-interview-guide.md  ← 검증 인터뷰 질문지 (운영자·참여자·상업 작가)
│   └── 04-dev-approach.md     ← 개발 방식(직접·외주·공동창업·하이브리드) 비교와 추천
└── wireframes/
    └── index.html             ← MVP 핵심 화면 와이어프레임 v0.1 (브라우저로 열기)
```

## 와이어프레임 v0.1

7개 화면: 온보딩(유형·연령대 설정) → 홈 → 모임 탐색 → 모임 상세 → 모임 만들기 → 커뮤니티(피드백 요청) → MY.

- 파일: [`wireframes/index.html`](wireframes/index.html). 내려받아 브라우저로 열면 됩니다. 화면 사이 링크가 동작합니다.
- 편집 가능한 캔버스: https://claude.ai/artifact/Dm9iPNeStHvh51Hm9tfHxo (비공개. 다른 사람에게 보여 주려면 페이지의 공유 메뉴에서 공유)
- 이 저장소가 GitHub Pages로 배포되어 있으므로 `main`에 합쳐지면 `https://<계정>.github.io/keyword-radar/photographing/wireframes/` 에서도 열립니다.

와이어프레임은 스크립트로 생성했습니다. 화면을 고칠 일이 있으면 HTML을 직접 고치기보다 다음 버전(v0.2)을 다시 생성하는 편이 낫습니다.

## 진행 상황 (플랜 13절 "바로 다음에 할 일")

| # | 할 일 | 상태 | 다음 행동 |
|---|---|---|---|
| 1 | 이름 확인 | 웹 조사 완료 | KIPRIS·앱스토어·도메인 직접 조회 후 `02-name-check.md` 표 채우기 |
| 2 | 인터뷰 | 질문지 완료 | 15명 모집 시작. 결과는 `docs/interviews/` 에 1명 1파일 |
| 3 | 개발 방식 | 비교표 완료 | 인터뷰 후 결정. `04-dev-approach.md` 6절에 기록 |
| 4 | 와이어프레임 | v0.1 완료 | 인터뷰 컨셉 반응(질문 22~26)을 반영해 v0.2 |

## 별도 저장소로 옮기기

```bash
# 새 저장소를 만든 뒤 (예: photographing)
git clone <새 저장소 URL> ~/photographing
cp -r photographing/* ~/photographing/
cd ~/photographing && git add . && git commit -m "docs: 포토그래핑 플랜·인터뷰 가이드·와이어프레임 v0.1" && git push
```
