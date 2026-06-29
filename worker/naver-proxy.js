// Cloudflare Worker — 네이버 키워드 분석 프록시
// 브라우저가 키 없이 키워드를 즉석 분석할 수 있도록 중계한다.
//
// 필수 환경변수(Secrets) — 네이버 검색 API:
//   NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
// 선택 환경변수(Secrets) — 네이버 검색광고 API(월간 검색량용):
//   SEARCHAD_API_KEY, SEARCHAD_SECRET, SEARCHAD_CUSTOMER_ID
//
// 사용: GET https://<worker-주소>/?q=키워드

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

function toNum(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[^0-9]/g, "");
  return s ? parseInt(s, 10) : 0;
}

// ---------- 네이버 검색 API ----------
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

// ---------- 네이버 검색광고 API (월간 검색량) ----------
async function hmacSha256Base64(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

async function searchVolume(env, keyword) {
  const { SEARCHAD_API_KEY, SEARCHAD_SECRET, SEARCHAD_CUSTOMER_ID } = env;
  if (!SEARCHAD_API_KEY || !SEARCHAD_SECRET || !SEARCHAD_CUSTOMER_ID) return null;

  const ts = Date.now().toString();
  const method = "GET";
  const path = "/keywordstool";
  const signature = await hmacSha256Base64(SEARCHAD_SECRET, `${ts}.${method}.${path}`);
  const hint = keyword.replace(/\s+/g, "");
  const url = `https://api.searchad.naver.com${path}?hintKeywords=${encodeURIComponent(hint)}&showDetail=1`;

  const res = await fetch(url, {
    headers: {
      "X-Timestamp": ts,
      "X-API-KEY": SEARCHAD_API_KEY,
      "X-Customer": String(SEARCHAD_CUSTOMER_ID),
      "X-Signature": signature,
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const list = data.keywordList || [];
  if (!list.length) return null;

  const norm = (s) => String(s).replace(/\s+/g, "").toLowerCase();
  const hit = list.find((x) => norm(x.relKeyword) === norm(keyword)) || list[0];
  const pc = toNum(hit.monthlyPcQcCnt);
  const mobile = toNum(hit.monthlyMobileQcCnt);
  return { pc, mobile, total: pc + mobile };
}

// ---------- 종합 분석 ----------
async function analyze(env, keyword) {
  const [blogRecent, blogTop, news, cafe, search] = await Promise.all([
    naverSearch(env, "blog", keyword, { display: "100", sort: "date" }),
    naverSearch(env, "blog", keyword, { display: "5", sort: "sim" }),
    naverSearch(env, "news", keyword, { display: "5", sort: "date" }),
    naverSearch(env, "cafearticle", keyword, { display: "1", sort: "sim" }).catch(() => ({ total: 0 })),
    searchVolume(env, keyword).catch(() => null),
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

  const blogTotal = blogRecent.total ?? 0;
  const cafeTotal = cafe.total ?? 0;
  const newsTotal = news.total ?? 0;
  const contentTotal = blogTotal + cafeTotal;

  let saturation = null;
  if (search && search.total > 0) {
    const pct = (n) => Math.round((n / search.total) * 1000) / 10;
    saturation = { blog: pct(blogTotal), cafe: pct(cafeTotal), total: pct(contentTotal) };
  }

  return {
    keyword,
    traffic: "",
    blogTotal,
    cafeTotal,
    newsTotal,
    contentTotal,
    recentToday,
    recentWeek,
    search,
    saturation,
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
