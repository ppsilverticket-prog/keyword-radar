// Cloudflare Worker — 네이버 검색 API 프록시
// 브라우저가 키 없이 키워드를 즉석 분석할 수 있도록 중계한다.
//
// 환경변수(Secrets) 2개 필요:
//   NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
//
// 사용: GET https://<worker-주소>/?q=키워드
//   → { keyword, blogTotal, newsTotal, recentToday, recentWeek, topBlogs[], topNews[] }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function stripTags(s = "") {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .trim();
}

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseBlogDate(postdate) {
  if (!postdate || postdate.length !== 8) return null;
  return new Date(
    `${postdate.slice(0, 4)}-${postdate.slice(4, 6)}-${postdate.slice(6, 8)}T00:00:00`
  );
}

async function naverSearch(env, type, query, params = {}) {
  const qs = new URLSearchParams({ query, ...params }).toString();
  const url = `https://openapi.naver.com/v1/search/${type}.json?${qs}`;
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": env.NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": env.NAVER_CLIENT_SECRET,
    },
  });
  if (!res.ok) throw new Error(`naver ${type} ${res.status}`);
  return res.json();
}

async function analyze(env, keyword) {
  const [blogRecent, blogTop, news] = await Promise.all([
    naverSearch(env, "blog", keyword, { display: "100", sort: "date" }),
    naverSearch(env, "blog", keyword, { display: "5", sort: "sim" }),
    naverSearch(env, "news", keyword, { display: "5", sort: "date" }),
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
    traffic: "",
    blogTotal: blogRecent.total ?? 0,
    newsTotal: news.total ?? 0,
    recentToday,
    recentWeek,
    topBlogs,
    topNews,
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      ...CORS,
    },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return json({ error: "q 파라미터가 필요합니다" }, 400);
    if (!env.NAVER_CLIENT_ID || !env.NAVER_CLIENT_SECRET) {
      return json({ error: "서버에 네이버 키가 설정되지 않았습니다" }, 500);
    }
    try {
      const data = await analyze(env, q);
      return json(data, 200);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 502);
    }
  },
};
