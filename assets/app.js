// assets/app.js
// data/data.json 을 읽어 카드로 렌더링하고 30분마다 자동 갱신한다.
// 히어로 검색 + 인기/관련 키워드 칩 + 정렬 + 즉석 분석(Cloudflare Worker) 지원.

const REFRESH_MS = 30 * 60 * 1000; // 30분
// 검색한 키워드를 네이버 데이터로 즉석 분석하는 프록시(Cloudflare Worker)
const WORKER_URL = "https://naver-proxy.ppsilverticket.workers.dev";

let nextRefreshAt = Date.now() + REFRESH_MS;
let allKeywords = [];   // 원본 데이터
let term = "";          // 검색어
let sortKey = "today";  // 정렬 기준

const $ = (id) => document.getElementById(id);

function fmtNum(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("ko-KR");
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", {
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function escapeHtml(s = "") {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function naverUrl(kw) {
  return "https://search.naver.com/search.naver?query=" + encodeURIComponent(kw);
}
function googleUrl(kw) {
  return "https://www.google.com/search?q=" + encodeURIComponent(kw);
}

// "1,000+", "10000+", "200+" → 1000 / 10000 / 200
function parseTraffic(t) {
  if (!t) return 0;
  const n = parseInt(String(t).replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

// ---------- 네이버 자동완성(연관 키워드) JSONP ----------
function jsonp(url, cbParam) {
  return new Promise((resolve, reject) => {
    const cb = "__ac_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
    const s = document.createElement("script");
    let done = false;
    const cleanup = () => { try { delete window[cb]; } catch (e) {} s.remove(); };
    window[cb] = (data) => { if (done) return; done = true; resolve(data); cleanup(); };
    s.onerror = () => { if (done) return; done = true; cleanup(); reject(new Error("jsonp error")); };
    s.src = url + (url.includes("?") ? "&" : "?") + cbParam + "=" + cb;
    document.body.appendChild(s);
    setTimeout(() => { if (done) return; done = true; cleanup(); reject(new Error("jsonp timeout")); }, 5000);
  });
}

async function fetchRelated(q) {
  const url = "https://ac.search.naver.com/nx/ac?q=" + encodeURIComponent(q) +
    "&con=0&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&run=2&rev=4&q_enc=UTF-8&st=100";
  const data = await jsonp(url, "_callback");
  const items = (data && data.items && data.items[0]) || [];
  return items
    .map((a) => (Array.isArray(a) ? a[0] : a))
    .filter(Boolean)
    .filter((k) => k.toLowerCase() !== q.toLowerCase())
    .slice(0, 12);
}

function listHtml(items, type) {
  if (!items || !items.length) {
    return '<div class="empty">표시할 항목이 없습니다.</div>';
  }
  return (
    '<ul class="list">' +
    items
      .map((it, i) => {
        const sub = type === "blog" ? it.blogger : it.press;
        const when = [sub, it.date].filter(Boolean).join(" · ");
        return (
          `<li><span class="idx">${i + 1}</span>` +
          `<a href="${escapeHtml(it.link)}" target="_blank" rel="noopener">${escapeHtml(it.title)}</a>` +
          (when ? `<span class="when">${escapeHtml(when)}</span>` : "") +
          `</li>`
        );
      })
      .join("") +
    "</ul>"
  );
}

function cardHtml(k) {
  const topRank = (typeof k.rank === "number" && k.rank <= 3) ? "top" : "";
  const rankLabel = (k.rank == null || k.rank === "") ? "🔎" : k.rank;
  return `
    <article class="card">
      <div class="card-head">
        <div class="rank ${topRank}">${rankLabel}</div>
        <div class="kw"><a href="${naverUrl(k.keyword)}" target="_blank" rel="noopener">${escapeHtml(k.keyword)}</a></div>
        ${k.traffic ? `<div class="traffic">${escapeHtml(k.traffic)}</div>` : ""}
      </div>

      <div class="metrics">
        <div class="metric">
          <div class="num hot">${fmtNum(k.recentToday)}</div>
          <div class="lbl">오늘 발행</div>
        </div>
        <div class="metric">
          <div class="num">${fmtNum(k.blogTotal)}</div>
          <div class="lbl">블로그 누적</div>
        </div>
        <div class="metric">
          <div class="num">${fmtNum(k.newsTotal)}</div>
          <div class="lbl">뉴스 누적</div>
        </div>
      </div>

      <div class="section">
        <h4>블로그 상위 노출</h4>
        ${listHtml(k.topBlogs, "blog")}
      </div>
      <div class="section">
        <h4>최신 뉴스</h4>
        ${listHtml(k.topNews, "news")}
      </div>

      <div class="searchlinks">
        <a href="${naverUrl(k.keyword)}" target="_blank" rel="noopener">네이버 순위 확인 ↗</a>
        <a href="${googleUrl(k.keyword)}" target="_blank" rel="noopener">구글 순위 확인 ↗</a>
      </div>
    </article>`;
}

function sortFns(key) {
  switch (key) {
    case "traffic": return (a, b) => parseTraffic(b.traffic) - parseTraffic(a.traffic);
    case "blog": return (a, b) => (b.blogTotal || 0) - (a.blogTotal || 0);
    case "news": return (a, b) => (b.newsTotal || 0) - (a.newsTotal || 0);
    case "name": return (a, b) => a.keyword.localeCompare(b.keyword, "ko");
    case "today":
    default: return (a, b) => (b.recentToday || 0) - (a.recentToday || 0);
  }
}

// ---------- 칩(인기/관련) ----------
function renderTrendingChips() {
  $("chipsLabel").textContent = "🔥 인기 키워드";
  const box = $("trendingChips");
  const top = allKeywords
    .slice()
    .sort((a, b) => (b.recentToday || 0) - (a.recentToday || 0))
    .slice(0, 10);
  box.innerHTML = top
    .map((k) => {
      const active = term && k.keyword === term ? "active" : "";
      return `<button type="button" class="chip ${active}" data-kw="${escapeHtml(k.keyword)}">#${escapeHtml(k.keyword)}</button>`;
    })
    .join("");
}

let chipReqId = 0;
async function updateChipRow() {
  const box = $("trendingChips");
  const label = $("chipsLabel");
  if (!term) { renderTrendingChips(); return; }

  label.textContent = `🔎 '${term}' 관련 키워드`;
  const myId = ++chipReqId;
  box.innerHTML = '<span class="chips-loading">연관 키워드 불러오는 중…</span>';
  try {
    const rel = await fetchRelated(term);
    if (myId !== chipReqId) return;
    if (!rel.length) { renderTrendingChips(); return; }
    box.innerHTML = rel
      .map((k) => `<button type="button" class="chip" data-kw="${escapeHtml(k)}">${escapeHtml(k)}</button>`)
      .join("");
  } catch (e) {
    if (myId !== chipReqId) return;
    renderTrendingChips();
  }
}

// ---------- 분석 챕터 렌더링 ----------
function fmtPct(p) {
  if (p == null) return "—";
  if (p >= 500) return "500%+";
  return p.toLocaleString("ko-KR") + "%";
}
function satMeta(p) {
  if (p == null) return { label: "—", cls: "" };
  if (p >= 300) return { label: "매우 높음", cls: "sat-vh" };
  if (p >= 100) return { label: "높음", cls: "sat-h" };
  if (p >= 30) return { label: "보통", cls: "sat-m" };
  return { label: "낮음", cls: "sat-l" };
}
function panelHtml(title, stats, sub) {
  const cells = stats
    .map((s) =>
      `<div class="pstat"><div class="pv ${s.cls || ""}">${s.v}</div>` +
      `<div class="pl">${escapeHtml(s.l)}</div>` +
      (s.s ? `<div class="ps ${s.cls || ""}">${escapeHtml(s.s)}</div>` : "") +
      `</div>`
    )
    .join("");
  return `<div class="panel"><h4>${escapeHtml(title)}</h4>` +
    `<div class="panel-stats">${cells}</div>` +
    (sub ? `<div class="panel-sub">${escapeHtml(sub)}</div>` : "") +
    `</div>`;
}
function analysisHtml(d) {
  let panels = "";

  if (d.search) {
    panels += panelHtml("월간 검색량", [
      { v: fmtNum(d.search.pc), l: "PC" },
      { v: fmtNum(d.search.mobile), l: "Mobile" },
      { v: fmtNum(d.search.total), l: "Total" },
    ]);
  } else {
    panels += `<div class="panel panel-muted"><h4>월간 검색량</h4>` +
      `<div class="panel-note">네이버 검색광고 API 키를 Worker에 등록하면 PC·모바일 검색량이 표시돼요.</div></div>`;
  }

  panels += panelHtml("콘텐츠 발행량 (누적)", [
    { v: fmtNum(d.blogTotal), l: "블로그" },
    { v: fmtNum(d.cafeTotal), l: "카페" },
    { v: fmtNum(d.contentTotal), l: "전체" },
  ]);

  if (d.saturation) {
    const sb = satMeta(d.saturation.blog);
    const sc = satMeta(d.saturation.cafe);
    const st = satMeta(d.saturation.total);
    panels += panelHtml("콘텐츠 포화 지수", [
      { v: fmtPct(d.saturation.blog), l: "블로그", s: sb.label, cls: sb.cls },
      { v: fmtPct(d.saturation.cafe), l: "카페", s: sc.label, cls: sc.cls },
      { v: fmtPct(d.saturation.total), l: "전체", s: st.label, cls: st.cls },
    ], "누적 발행량 ÷ 월 검색량");
  }

  panels += panelHtml("발행 추이 · 뉴스", [
    { v: fmtNum(d.recentToday), l: "오늘 블로그" },
    { v: fmtNum(d.recentWeek), l: "최근 7일" },
    { v: fmtNum(d.newsTotal), l: "뉴스 누적" },
  ]);

  const lists =
    `<div class="analysis-lists">` +
    `<div class="al-col"><h4>블로그 상위 노출</h4>${listHtml(d.topBlogs, "blog")}</div>` +
    `<div class="al-col"><h4>최신 뉴스</h4>${listHtml(d.topNews, "news")}</div>` +
    `</div>`;

  const links =
    `<div class="searchlinks">` +
    `<a href="${naverUrl(d.keyword)}" target="_blank" rel="noopener">네이버 순위 확인 ↗</a>` +
    `<a href="${googleUrl(d.keyword)}" target="_blank" rel="noopener">구글 순위 확인 ↗</a>` +
    `</div>`;

  const ai = d.summary
    ? `<div class="ai-summary"><div class="ai-label">🤖 AI 요약</div><p>${escapeHtml(d.summary)}</p></div>`
    : "";

  return `<div class="analysis">${ai}<div class="panel-grid">${panels}</div>${lists}${links}</div>`;
}

// ---------- 즉석 분석 (Cloudflare Worker 프록시) ----------
let analyzeReqId = 0;
async function analyzeViaWorker(kw) {
  const box = $("searchResult");
  if (!WORKER_URL || !kw) { box.hidden = true; return; }
  if (allKeywords.some((k) => k.keyword === kw)) { box.hidden = true; return; }

  box.hidden = false;
  box.innerHTML =
    `<h3 class="sr-head">🔎 '${escapeHtml(kw)}' 분석 결과</h3>` +
    `<div class="sr-loading">네이버에서 분석 중…</div>`;
  const myId = ++analyzeReqId;
  try {
    const bucket = Math.floor(Date.now() / 300000); // 5분 단위 캐시 버킷
    const r = await fetch(WORKER_URL + "/?q=" + encodeURIComponent(kw) + "&t=" + bucket);
    const data = await r.json();
    if (myId !== analyzeReqId) return;
    if (!r.ok || data.error) throw new Error(data.error || ("HTTP " + r.status));
    box.innerHTML =
      `<h3 class="sr-head">🔎 '${escapeHtml(kw)}' 분석</h3>` +
      analysisHtml(data);
  } catch (e) {
    if (myId !== analyzeReqId) return;
    box.innerHTML =
      `<h3 class="sr-head">🔎 '${escapeHtml(kw)}' 분석 결과</h3>` +
      `<div class="sr-error">분석을 불러오지 못했어요 (${escapeHtml(String((e && e.message) || e))}).</div>`;
  }
}

function render() {
  const cards = $("cards");
  const emptyState = $("emptyState");

  let list = allKeywords;
  if (term) {
    const t = term.toLowerCase();
    list = list.filter((k) => k.keyword.toLowerCase().includes(t));
  }
  list = list.slice().sort(sortFns(sortKey));

  $("count").innerHTML =
    `<strong>${list.length}</strong>개` +
    (term && allKeywords.length !== list.length ? ` / 전체 ${allKeywords.length}` : "");

  if (!list.length) {
    cards.innerHTML = "";
    emptyState.hidden = false;
    emptyState.innerHTML = term
      ? `'${escapeHtml(term)}'는 실시간 트렌드 목록에 없어요. 위 <b>분석 결과</b>와 <b>관련 키워드</b>를 확인하거나 ` +
        `<a href="${naverUrl(term)}" target="_blank" rel="noopener">네이버</a> · ` +
        `<a href="${googleUrl(term)}" target="_blank" rel="noopener">구글</a>에서 검색해 보세요.`
      : "표시할 키워드가 없습니다.";
  } else {
    emptyState.hidden = true;
    cards.innerHTML = list.map(cardHtml).join("");
  }
}

// 검색 확정(엔터/버튼/칩) → 필터 + 연관 키워드 + 즉석 분석
function submitSearch(value) {
  term = (value || "").trim();
  const input = $("searchInput");
  if (input.value !== term) input.value = term;
  render();
  updateChipRow();
  if (term) {
    analyzeViaWorker(term);
    document.querySelector(".results").scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    $("searchResult").hidden = true;
  }
}

async function load() {
  const errEl = $("error");
  errEl.hidden = true;
  try {
    const res = await fetch(`data/data.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`데이터를 불러오지 못했습니다 (HTTP ${res.status})`);
    const data = await res.json();

    $("updatedAt").textContent = fmtTime(data.updatedAt);

    const badge = $("badge");
    if (data.source === "live") {
      badge.textContent = "실데이터";
      badge.className = "badge live";
    } else {
      badge.textContent = "데모 데이터 (네이버 키 미설정)";
      badge.className = "badge demo";
    }

    allKeywords = Array.isArray(data.keywords) ? data.keywords : [];
    render();
    if (!term) renderTrendingChips();
  } catch (e) {
    errEl.hidden = false;
    errEl.textContent = "⚠️ " + e.message +
      " — data/data.json 이 아직 생성되지 않았을 수 있어요.";
  }
  nextRefreshAt = Date.now() + REFRESH_MS;
}

function tickCountdown() {
  const remain = Math.max(0, nextRefreshAt - Date.now());
  const m = Math.floor(remain / 60000);
  const s = Math.floor((remain % 60000) / 1000);
  $("countdown").textContent = `${m}분 ${String(s).padStart(2, "0")}초`;
}

// 입력(타이핑): 트렌드 필터 + 연관 키워드만 (분석은 확정 시에만 → 쿼터 절약)
let searchTimer;
$("searchInput").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const v = e.target.value;
  $("searchResult").hidden = true;
  searchTimer = setTimeout(() => { term = v.trim(); render(); updateChipRow(); }, 180);
});
$("searchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); submitSearch(e.target.value); }
});
$("searchBtn").addEventListener("click", () => submitSearch($("searchInput").value));

// 칩 클릭 → 해당 키워드로 검색/드릴다운 (분석 포함)
$("trendingChips").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  const kw = btn.dataset.kw;
  submitSearch(term === kw ? "" : kw);
});

$("sortSelect").addEventListener("change", (e) => { sortKey = e.target.value; render(); });
$("refreshBtn").addEventListener("click", load);

setInterval(load, REFRESH_MS);
setInterval(tickCountdown, 1000);
load();
tickCountdown();
