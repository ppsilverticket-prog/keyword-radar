// scripts/fetch.mjs
// 10분마다 GitHub Actions가 실행하는 데이터 수집 스크립트.
//
// 1) 구글 트렌드(한국) 실시간 인기 키워드 목록을 가져온다  (API 키 불필요)
// 2) 각 키워드를 네이버 검색 API로 분석한다              (NAVER_CLIENT_ID/SECRET 필요)
//    - 블로그/뉴스 전체 발행량(total)
//    - 오늘 / 최근 7일 발행 글 수  (= "지금 많이 올라오는지" 지표)
//    - 상위 노출 글 5개
// 3) data/data.json 으로 저장한다 → GitHub Pages가 이 파일을 읽어서 표시
//
// 네이버 키가 없으면 자동으로 데모(가짜) 데이터를 생성한다.

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "..", "data", "data.json");

const CLIENT_ID = process.env.NAVER_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const MAX_KEYWORDS = Number(process.env.MAX_KEYWORDS || 8);

// 구글 트렌드가 막혔을 때 쓰는 예비 키워드
const FALLBACK_KEYWORDS = [
  "날씨", "주식", "환율", "부동산", "여행",
  "건강", "맛집", "다이어트", "재테크", "취업",
];

// ---------- 유틸 ----------
function stripTags(s = "") {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function fetchText(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

// ---------- 1) 구글 트렌드 인기 키워드 ----------
async function getTrendingKeywords() {
  const urls = [
    "https://trends.google.com/trending/rss?geo=KR",
    "https://trends.google.co.kr/trending/rss?geo=KR",
  ];
  for (const url of urls) {
    try {
      const xml = await fetchText(url, {
        headers: { "User-Agent": "Mozilla/5.0 (keyword-radar)" },
      });
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
      const out = [];
      for (const m of items) {
        const block = m[1];
        const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
        const trafficMatch = block.match(
          /<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/
        );
        const keyword = stripTags(titleMatch ? titleMatch[1] : "");
        if (!keyword) continue;
        out.push({
          keyword,
          traffic: trafficMatch ? stripTags(trafficMatch[1]) : "",
        });
      }
      if (out.length) return out.slice(0, MAX_KEYWORDS);
    } catch (e) {
      console.error(`트렌드 수집 실패(${url}): ${e.message}`);
    }
  }
  console.error("구글 트렌드 수집 실패 → 예비 키워드 사용");
  return FALLBACK_KEYWORDS.slice(0, MAX_KEYWORDS).map((keyword) => ({
    keyword,
    traffic: "",
  }));
}

// ---------- 2) 네이버 검색 API ----------
async function naverSearch(type, query, params = {}) {
  const qs = new URLSearchParams({ query, ...params }).toString();
  const url = `https://openapi.naver.com/v1/search/${type}.json?${qs}`;
  const json = JSON.parse(
    await fetchText(url, {
      headers: {
        "X-Naver-Client-Id": CLIENT_ID,
        "X-Naver-Client-Secret": CLIENT_SECRET,
      },
    })
  );
  return json;
}

function parseBlogDate(postdate) {
  // "20260629" → Date
  if (!postdate || postdate.length !== 8) return null;
  return new Date(
    `${postdate.slice(0, 4)}-${postdate.slice(4, 6)}-${postdate.slice(6, 8)}T00:00:00`
  );
}

async function analyzeKeyword(item) {
  const { keyword, traffic } = item;

  // 블로그: 최근순 100건(발행 속도 계산) + 정확도순 5건(상위 노출), 뉴스 5건
  const [blogRecent, blogTop, news] = await Promise.all([
    naverSearch("blog", keyword, { display: "100", sort: "date" }),
    naverSearch("blog", keyword, { display: "5", sort: "sim" }),
    naverSearch("news", keyword, { display: "5", sort: "date" }),
  ]);

  const now = new Date();
  const todayStr = ymd(now);
  const weekAgo = new Date(now.getTime() - 7 * 86400000);

  let recentToday = 0;
  let recentWeek = 0;
  for (const b of blogRecent.items || []) {
    const d = parseBlogDate(b.postdate);
    if (!d) continue;
    if (ymd(d) === todayStr) recentToday++;
    if (d >= weekAgo) recentWeek++;
  }

  const topBlogs = (blogTop.items || []).map((b) => ({
    title: stripTags(b.title),
    link: b.link,
    blogger: stripTags(b.bloggername || ""),
    date: b.postdate
      ? `${b.postdate.slice(0, 4)}-${b.postdate.slice(4, 6)}-${b.postdate.slice(6, 8)}`
      : "",
  }));

  const topNews = (news.items || []).map((n) => ({
    title: stripTags(n.title),
    link: n.originallink || n.link,
    press: "",
    date: n.pubDate ? ymd(new Date(n.pubDate)) : "",
  }));

  return {
    keyword,
    traffic,
    blogTotal: blogRecent.total ?? 0,
    newsTotal: news.total ?? 0,
    recentToday,
    recentWeek,
    topBlogs,
    topNews,
  };
}

// ---------- 데모 데이터 ----------
function demoData(keywords) {
  const seedNum = (s) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
  const today = ymd(new Date());
  return keywords.map((k) => {
    const seed = seedNum(k.keyword);
    return {
      keyword: k.keyword,
      traffic: k.traffic || `${(seed % 50) + 1},000+`,
      blogTotal: ((seed * 137) % 90000) + 1000,
      newsTotal: ((seed * 31) % 5000) + 50,
      recentToday: (seed % 25) + 1,
      recentWeek: (seed % 80) + 10,
      topBlogs: Array.from({ length: 3 }, (_, j) => ({
        title: `[예시] ${k.keyword} 관련 블로그 글 ${j + 1}`,
        link:
          "https://search.naver.com/search.naver?query=" +
          encodeURIComponent(k.keyword),
        blogger: `블로거${j + 1}`,
        date: today,
      })),
      topNews: Array.from({ length: 3 }, (_, j) => ({
        title: `[예시] ${k.keyword} 관련 뉴스 ${j + 1}`,
        link:
          "https://search.naver.com/search.naver?where=news&query=" +
          encodeURIComponent(k.keyword),
        press: "",
        date: today,
      })),
    };
  });
}

// ---------- 메인 ----------
async function main() {
  const trending = await getTrendingKeywords();
  let keywords;
  let source;

  if (CLIENT_ID && CLIENT_SECRET) {
    source = "live";
    keywords = [];
    for (const item of trending) {
      try {
        keywords.push(await analyzeKeyword(item));
      } catch (e) {
        console.error(`'${item.keyword}' 분석 실패: ${e.message}`);
        keywords.push({
          keyword: item.keyword,
          traffic: item.traffic,
          blogTotal: 0,
          newsTotal: 0,
          recentToday: 0,
          recentWeek: 0,
          topBlogs: [],
          topNews: [],
          error: e.message,
        });
      }
    }
  } else {
    console.error("네이버 키 없음 → 데모 데이터 생성 (source=demo)");
    source = "demo";
    keywords = demoData(trending);
  }

  // 발행 속도(오늘 글 수) 높은 순으로 정렬
  keywords.sort((a, b) => b.recentToday - a.recentToday);
  keywords.forEach((k, i) => (k.rank = i + 1));

  const payload = {
    updatedAt: new Date().toISOString(),
    source,
    keywords,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`완료: ${keywords.length}개 키워드, source=${source} → ${OUT_PATH}`);
}

main().catch((e) => {
  console.error("치명적 오류:", e);
  process.exit(1);
});
