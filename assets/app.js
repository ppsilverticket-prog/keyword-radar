// assets/app.js
// data/data.json 을 읽어 카드로 렌더링하고 30분마다 자동 갱신한다.
// 검색 필터 + 정렬 지원.

const REFRESH_MS = 30 * 60 * 1000; // 30분
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
  const topRank = k.rank <= 3 ? "top" : "";
  return `
    <article class="card">
      <div class="card-head">
        <div class="rank ${topRank}">${k.rank}</div>
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
    case "blog": return (a, b) => (b.blogTotal || 0) - (a.blogTotal || 0);
    case "news": return (a, b) => (b.newsTotal || 0) - (a.newsTotal || 0);
    case "name": return (a, b) => a.keyword.localeCompare(b.keyword, "ko");
    case "today":
    default: return (a, b) => (b.recentToday || 0) - (a.recentToday || 0);
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
    `<strong>${list.length}</strong>개 키워드` +
    (term && allKeywords.length !== list.length ? ` / 전체 ${allKeywords.length}` : "");

  if (!list.length) {
    cards.innerHTML = "";
    emptyState.hidden = false;
  } else {
    emptyState.hidden = true;
    cards.innerHTML = list.map(cardHtml).join("");
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

// 검색 입력 (디바운스)
let searchTimer;
$("searchInput").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const v = e.target.value;
  searchTimer = setTimeout(() => { term = v.trim(); render(); }, 120);
});

$("sortSelect").addEventListener("change", (e) => { sortKey = e.target.value; render(); });
$("refreshBtn").addEventListener("click", load);

setInterval(load, REFRESH_MS);
setInterval(tickCountdown, 1000);
load();
tickCountdown();
