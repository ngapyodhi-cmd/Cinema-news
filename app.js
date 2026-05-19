const statusEl = document.getElementById("status");
const newsBoardEl = document.getElementById("news-board");
const listSmallEl = document.getElementById("news-list-small");
const listMultiEl = document.getElementById("news-list-multi");
const countSmallEl = document.getElementById("count-small");
const countMultiEl = document.getElementById("count-multi");
const errorSmallEl = document.getElementById("error-small");
const errorMultiEl = document.getElementById("error-multi");
const errorCardEl = document.getElementById("error-card");
const errorMessageEl = document.getElementById("error-message");
const footerMetaEl = document.getElementById("footer-meta");
const btnRefresh = document.getElementById("btn-refresh");

function formatDate(isoOrRss) {
  if (!isoOrRss) return "";
  const date = new Date(isoOrRss);
  if (Number.isNaN(date.getTime())) return isoOrRss;
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function splitTitleSource(title) {
  const dash = title.lastIndexOf(" - ");
  if (dash === -1) return { headline: title, outlet: null };
  return {
    headline: title.slice(0, dash),
    outlet: title.slice(dash + 3),
  };
}

function createNewsCard(item, index, columnClass) {
  const li = document.createElement("li");
  li.className = `news-card ${columnClass}`;
  li.style.animationDelay = `${index * 40}ms`;

  const { headline, outlet } = splitTitleSource(item.title);
  const source = item.source || outlet;

  const rank = document.createElement("span");
  rank.className = "news-rank";
  rank.textContent = String(index + 1);

  const body = document.createElement("div");
  body.className = "news-body";

  const link = document.createElement("a");
  link.className = "news-title";
  link.href = item.link;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = headline;

  const meta = document.createElement("p");
  meta.className = "news-meta";

  if (source) {
    const sourceSpan = document.createElement("span");
    sourceSpan.className = "news-source";
    sourceSpan.textContent = source;
    meta.appendChild(sourceSpan);
  }

  if (item.pubDate) {
    const time = document.createElement("time");
    time.dateTime = new Date(item.pubDate).toISOString();
    time.textContent = formatDate(item.pubDate);
    meta.appendChild(time);
  }

  body.appendChild(link);
  if (meta.childElementCount > 0) body.appendChild(meta);

  li.append(rank, body);
  return li;
}

function renderColumn(section, listEl, countEl, errorEl, columnClass) {
  const { items, error, label, query } = section;

  listEl.replaceChildren();
  errorEl.hidden = true;
  errorEl.textContent = "";

  if (items.length > 0) {
    items.forEach((item, i) => {
      listEl.appendChild(createNewsCard(item, i, columnClass));
    });
    countEl.textContent = `최신 ${items.length}건`;
    listEl.hidden = false;
  } else {
    listEl.hidden = true;
    countEl.textContent = "0건";
    if (error) {
      errorEl.textContent = error;
      errorEl.hidden = false;
    }
  }
}

function setLoading(loading) {
  btnRefresh.disabled = loading;
  btnRefresh.classList.toggle("btn--loading", loading);
}

function showError(message) {
  newsBoardEl.hidden = true;
  errorCardEl.hidden = false;
  errorMessageEl.textContent = message;
  statusEl.textContent = "뉴스를 불러오지 못했습니다.";
  statusEl.classList.add("status--error");
}

function showNews(data) {
  errorCardEl.hidden = true;
  statusEl.classList.remove("status--error");

  renderColumn(
    data.smallCinema,
    listSmallEl,
    countSmallEl,
    errorSmallEl,
    "news-card--small"
  );
  renderColumn(
    data.multiplex,
    listMultiEl,
    countMultiEl,
    errorMultiEl,
    "news-card--multi"
  );

  newsBoardEl.hidden = false;

  const total =
    (data.smallCinema.items?.length || 0) + (data.multiplex.items?.length || 0);
  statusEl.textContent = `총 ${total}건 · ${formatDate(data.fetchedAt)} 기준`;
  footerMetaEl.textContent = `데이터 출처: ${data.source} · 작은영화관 · 영화관`;
}

async function loadNews() {
  setLoading(true);
  statusEl.textContent = "Google 뉴스에서 검색 중…";
  statusEl.classList.remove("status--error");
  errorCardEl.hidden = true;
  newsBoardEl.hidden = true;

  try {
    const res = await fetch("/api/news");
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || "알 수 없는 오류가 발생했습니다.");
      return;
    }

    showNews(data);
  } catch {
    showError("서버에 연결할 수 없습니다. node server.js로 앱을 실행해 주세요.");
  } finally {
    setLoading(false);
  }
}

btnRefresh.addEventListener("click", loadNews);
loadNews();
