// Cloudflare Worker — 네이버 키워드 분석 + AI 요약 프록시
// 브라우저가 키 없이 키워드를 즉석 분석할 수 있도록 중계한다.
//
// 필수 Secrets — 네이버 검색 API:
//   NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
// 선택 Secrets — 네이버 검색광고 API(월간 검색량):
//   SEARCHAD_API_KEY, SEARCHAD_SECRET, SEARCHAD_CUSTOMER_ID
// 선택 Secrets — Google Gemini(AI 요약):
//   GEMINI_API_KEY
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

async function hmacSha256Base64(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

async function searchVolume(env, keyword) {
  let { SEARCHAD_API_KEY, SEARCHAD_SECRET, SEARCHAD_CUSTOMER_ID } = env;
  const missing = [];
  if (!SEARCHAD_API_KEY) missing.push("SEARCHAD_API_KEY");
  if (!SEARCHAD_SECRET) missing.push("SEARCHAD_SECRET");
  if (!SEARCHAD_CUSTOMER_ID) missing.push("SEARCHAD_CUSTOMER_ID");
  if (missing.length) return { error: "시크릿 미등록: " + missing.join(", ") };

  SEARCHAD_API_KEY = String(SEARCHAD_API_KEY).trim();
  SEARCHAD_SECRET = String(SEARCHAD_SECRET).trim();
  SEARCHAD_CUSTOMER_ID = String(SEARCHAD_CUSTOMER_ID).trim();

  const ts = Date.now().toString();
  const method = "GET";
  const path = "/keywordstool";
  const signature = await hmacSha256Base64(SEARCHAD_SECRET, `${ts}.${method}.${path}`);
  const hint = keyword.replace(/\s+/g, "");
  const url = `https://api.searchad.naver.com${path}?hintKeywords=${encodeURIComponent(hint)}&showDetail=1`;

  let res;
  try {
    res = await fetch(url, {
      headers: {
        "X-Timestamp": ts,
        "X-API-KEY": SEARCHAD_API_KEY,
        "X-Customer": SEARCHAD_CUSTOMER_ID,
        "X-Signature": signature,
      },
    });
  } catch (e) {
    return { error: "fetch 실패: " + String((e && e.message) || e) };
  }

  if (!res.ok) {
    let body = "";
    try { body = (await res.text()).slice(0, 180); } catch (e) {}
    return { error: `검색광고 HTTP ${res.status} — ${body}` };
  }

  let data;
  try { data = await res.json(); } catch (e) { return { error: "응답 JSON 파싱 실패" }; }
  const list = data.keywordList || [];
  if (!list.length) return { error: "keywordList 비어있음" };

  const norm = (s) => String(s).replace(/\s+/g, "").toLowerCase();
  const hit = list.find((x) => norm(x.relKeyword) === norm(keyword)) || list[0];
  const pc = toNum(hit.monthlyPcQcCnt);
  const mobile = toNum(hit.monthlyMobileQcCnt);
  return { ok: true, pc, mobile, total: pc + mobile };
}

async function aiSummary(env, keyword, d) {
  const key = env.GEMINI_API_KEY;
  if (!key) return { error: "GEMINI_API_KEY 미등록" };

  const s = d.search;
  const sat = d.saturation;
  const titles = (d.topBlogs || []).map((b) => b.title).slice(0, 5).join(" | ");
  const prompt =
    "너는 네이버 블로그·검색 마케팅 분석가야. 아래 키워드 데이터를 보고 한국어로 2~3문장의 핵심 인사이트를 써줘. " +
    "검색 수요, 발행 경쟁(포화도), 어떤 콘텐츠로 공략하면 좋을지를 자연스러운 문단으로. 과장·군더더기·머리말·불릿 없이.\n\n" +
    `키워드: ${keyword}\n` +
    `월간 검색량: ${s ? `PC ${s.pc}, 모바일 ${s.mobile}, 합계 ${s.total}` : "정보 없음"}\n` +
    `누적 발행량: 블로그 ${d.blogTotal}, 카페 ${d.cafeTotal}, 전체 ${d.contentTotal}\n` +
    `콘텐츠 포화지수(전체): ${sat ? sat.total + "%" : "정보 없음"}\n` +
    `오늘/최근7일 블로그 발행: ${d.recentToday} / ${d.recentWeek}\n` +
    `상위 노출 블로그 제목: ${titles || "없음"}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(key)}`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 320 },
      }),
    });
  } catch (e) {
    return { error: "fetch 실패: " + String((e && e.message) || e) };
  }
  if (!res.ok) {
    let body = "";
    try { body = (await res.text()).slice(0, 180); } catch (e) {}
    return { error: `Gemini HTTP ${res.status} — ${body}` };
  }
  let j;
  try { j = await res.json(); } catch (e) { return { error: "응답 JSON 파싱 실패" }; }
  const text = j && j.candidates && j.candidates[0] &&
    j.candidates[0].content && j.candidates[0].content.parts &&
    j.candidates[0].content.parts[0] && j.candidates[0].content.parts[0].text;
  if (!text) return { error: "빈 응답" };
  return { ok: true, text: String(text).trim() };
}

async function analyze(env, keyword) {
  const [blogRecent, blogTop, news, cafe, sv] = await Promise.all([
    naverSearch(env, "blog", keyword, { display: "100", sort: "date" }),
    naverSearch(env, "blog", keyword, { display: "5", sort: "sim" }),
    naverSearch(env, "news", keyword, { display: "5", sort: "date" }),
    naverSearch(env, "cafearticle", keyword, { display: "1", sort: "sim" }).catch(() => ({ total: 0 })),
    searchVolume(env, keyword).catch((e) => ({ error: String((e && e.message) || e) })),
  ]);

  let search = null;
  let searchDebug = null;
  if (sv && sv.ok) search = { pc: sv.pc, mobile: sv.mobile, total: sv.total };
  else searchDebug = (sv && sv.error) || "알 수 없는 오류";

  const now = new Date();
  const todayStr = ymd(now);
  const weekAgo = new Date(now.getTime() - 7 * 86400000);

  let recentToday = 0;
  let recentWeek = 0;
  for (const b of blogRecent.items || []) {
    const dt = parseBlogDate(b.postdate);
    if (!dt) continue;
    if (ymd(dt) === todayStr) recentToday++;
    if (dt >= weekAgo) recentWeek++;
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

  const result = {
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
    searchDebug,
    topBlogs,
    topNews,
  };

  const sum = await aiSummary(env, keyword, result).catch((e) => ({ error: String((e && e.message) || e) }));
  result.summary = sum && sum.ok ? sum.text : null;
  result.summaryDebug = sum && sum.ok ? null : (sum && sum.error) || "알 수 없는 오류";

  return result;
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
