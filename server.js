<<<<<<< HEAD
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3456;
const MAX_ITEMS = 20;
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

const FEEDS = {
  smallCinema: {
    id: "smallCinema",
    label: "작은영화관",
    googleQuery: '"작은영화관"',
    naverQueries: ["작은영화관"],
  },
  multiplex: {
    id: "multiplex",
    label: "영화관",
    googleQuery:
      '(멀티플렉스 OR 영화관 OR CGV OR 롯데시네마 OR 메가박스 OR 특별관) -"작은영화관" -"예능" -"방송"',
    naverQueries: ["멀티플렉스", "영화관", "CGV", "롯데시네마", "메가박스", "특별관"],
    excludeSmallCinema: true,
  },
};

const SMALL_CINEMA_PATTERN = /작은\s*영화관/i;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/rss+xml, application/xml, text/xml, */*",
};

function isNaverConfigured() {
  return Boolean(NAVER_CLIENT_ID && NAVER_CLIENT_SECRET);
}

function rssUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
}

function decodeXml(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function stripHtml(text) {
  return decodeXml(text.replace(/<[^>]+>/g, ""));
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = block.match(re);
  return match ? decodeXml(match[1]) : "";
}

function parseRss(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const pubDate = extractTag(block, "pubDate");
    const source = extractTag(block, "source");

    if (title && link) {
      items.push({
        title,
        link,
        pubDate,
        source: source || "Google News",
        provider: "google",
      });
    }
  }

  return items;
}

function sortByNewest(items) {
  return [...items].sort((a, b) => {
    const ta = Date.parse(a.pubDate);
    const tb = Date.parse(b.pubDate);
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = (item.link || item.title).trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function excludeSmallCinemaArticles(items) {
  return items.filter((item) => !SMALL_CINEMA_PATTERN.test(item.title));
}

async function fetchGoogleNews(googleQuery) {
  const response = await fetch(rssUrl(googleQuery), { headers: FETCH_HEADERS });
  if (!response.ok) return [];
  const xml = await response.text();
  return parseRss(xml);
}

async function fetchNaverNews(searchQuery) {
  if (!isNaverConfigured()) return [];

  const url = new URL("https://openapi.naver.com/v1/search/news.json");
  url.searchParams.set("query", searchQuery);
  url.searchParams.set("display", String(MAX_ITEMS));
  url.searchParams.set("sort", "date");

  const response = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
  });

  if (!response.ok) return [];

  const data = await response.json();
  if (!Array.isArray(data.items)) return [];

  return data.items
    .map((item) => ({
      title: stripHtml(item.title),
      link: item.link || item.originallink,
      pubDate: item.pubDate,
      source: "네이버 뉴스",
      provider: "naver",
    }))
    .filter((item) => item.title && item.link);
}

async function fetchCategoryFeed({ id, label, googleQuery, naverQueries, excludeSmallCinema }) {
  const naverFetches = isNaverConfigured()
    ? naverQueries.map((q) => fetchNaverNews(q))
    : [];

  const [googleItems, ...naverGroups] = await Promise.all([
    fetchGoogleNews(googleQuery),
    ...naverFetches,
  ]);

  let items = [...googleItems, ...naverGroups.flat()];

  if (excludeSmallCinema) {
    items = excludeSmallCinemaArticles(items);
  }

  items = dedupeItems(sortByNewest(items)).slice(0, MAX_ITEMS);

  if (items.length === 0) {
    return {
      id,
      label,
      error: isNaverConfigured()
        ? "검색 결과가 없습니다."
        : "검색 결과가 없습니다. (네이버 API 키 미설정 시 Google만 검색)",
      items: [],
    };
  }

  return { id, label, items };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function serveStatic(res, urlPath) {
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(__dirname, path.normalize(safePath).replace(/^(\.\.[/\\])+/, ""));

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

async function handleNewsApi(res) {
  try {
    const [smallCinema, multiplex] = await Promise.all([
      fetchCategoryFeed(FEEDS.smallCinema),
      fetchCategoryFeed(FEEDS.multiplex),
    ]);

    const hasAny = smallCinema.items.length > 0 || multiplex.items.length > 0;

    if (!hasAny) {
      sendJson(res, 404, { error: "검색 결과가 없습니다." });
      return;
    }

    const naverEnabled = isNaverConfigured();

    sendJson(res, 200, {
      source: naverEnabled ? "Google News · 네이버 뉴스" : "Google News",
      naverEnabled,
      fetchedAt: new Date().toISOString(),
      smallCinema,
      multiplex,
    });
  } catch {
    sendJson(res, 500, { error: "뉴스를 불러오는 중 오류가 발생했습니다." });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  if (url.pathname === "/api/news") {
    handleNewsApi(res);
    return;
  }

  serveStatic(res, url.pathname);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`영화관 뉴스 앱: port ${PORT}`);
  console.log(`네이버 뉴스 API: ${isNaverConfigured() ? "사용" : "미설정"}`);
});
=======
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3456;
const MAX_ITEMS = 20;
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

const FEEDS = {
  smallCinema: {
    id: "smallCinema",
    label: "작은영화관",
    googleQuery: '작은영화관',
    naverQueries: ["작은영화관"],
  },
  multiplex: {
    id: "multiplex",
    label: "영화관",
    googleQuery:
      '(멀티플렉스 OR 영화관 OR CGV OR 롯데시네마 OR 메가박스 OR 특별관) -"작은영화관"',
    naverQueries: ["멀티플렉스", "영화관", "CGV", "롯데시네마", "메가박스", "특별관"],
    excludeSmallCinema: true,
  },
};

const SMALL_CINEMA_PATTERN = /작은\s*영화관/i;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/rss+xml, application/xml, text/xml, */*",
};

function isNaverConfigured() {
  return Boolean(NAVER_CLIENT_ID && NAVER_CLIENT_SECRET);
}

function rssUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
}

function decodeXml(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function stripHtml(text) {
  return decodeXml(text.replace(/<[^>]+>/g, ""));
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = block.match(re);
  return match ? decodeXml(match[1]) : "";
}

function parseRss(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const pubDate = extractTag(block, "pubDate");
    const source = extractTag(block, "source");

    if (title && link) {
      items.push({
        title,
        link,
        pubDate,
        source: source || "Google News",
        provider: "google",
      });
    }
  }

  return items;
}

function sortByNewest(items) {
  return [...items].sort((a, b) => {
    const ta = Date.parse(a.pubDate);
    const tb = Date.parse(b.pubDate);
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = (item.link || item.title).trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function excludeSmallCinemaArticles(items) {
  return items.filter((item) => !SMALL_CINEMA_PATTERN.test(item.title));
}

async function fetchGoogleNews(googleQuery) {
  const response = await fetch(rssUrl(googleQuery), { headers: FETCH_HEADERS });
  if (!response.ok) return [];
  const xml = await response.text();
  return parseRss(xml);
}

async function fetchNaverNews(searchQuery) {
  if (!isNaverConfigured()) return [];

  const url = new URL("https://openapi.naver.com/v1/search/news.json");
  url.searchParams.set("query", searchQuery);
  url.searchParams.set("display", String(MAX_ITEMS));
  url.searchParams.set("sort", "date");

  const response = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
  });

  if (!response.ok) return [];

  const data = await response.json();
  if (!Array.isArray(data.items)) return [];

  return data.items
    .map((item) => ({
      title: stripHtml(item.title),
      link: item.link || item.originallink,
      pubDate: item.pubDate,
      source: "네이버 뉴스",
      provider: "naver",
    }))
    .filter((item) => item.title && item.link);
}

async function fetchCategoryFeed({ id, label, googleQuery, naverQueries, excludeSmallCinema }) {
  const naverFetches = isNaverConfigured()
    ? naverQueries.map((q) => fetchNaverNews(q))
    : [];

  const [googleItems, ...naverGroups] = await Promise.all([
    fetchGoogleNews(googleQuery),
    ...naverFetches,
  ]);

  let items = [...googleItems, ...naverGroups.flat()];

  if (excludeSmallCinema) {
    items = excludeSmallCinemaArticles(items);
  }

  items = dedupeItems(sortByNewest(items)).slice(0, MAX_ITEMS);

  if (items.length === 0) {
    return {
      id,
      label,
      error: isNaverConfigured()
        ? "검색 결과가 없습니다."
        : "검색 결과가 없습니다. (네이버 API 키 미설정 시 Google만 검색)",
      items: [],
    };
  }

  return { id, label, items };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function serveStatic(res, urlPath) {
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(__dirname, path.normalize(safePath).replace(/^(\.\.[/\\])+/, ""));

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

async function handleNewsApi(res) {
  try {
    const [smallCinema, multiplex] = await Promise.all([
      fetchCategoryFeed(FEEDS.smallCinema),
      fetchCategoryFeed(FEEDS.multiplex),
    ]);

    const hasAny = smallCinema.items.length > 0 || multiplex.items.length > 0;

    if (!hasAny) {
      sendJson(res, 404, { error: "검색 결과가 없습니다." });
      return;
    }

    const naverEnabled = isNaverConfigured();

    sendJson(res, 200, {
      source: naverEnabled ? "Google News · 네이버 뉴스" : "Google News",
      naverEnabled,
      fetchedAt: new Date().toISOString(),
      smallCinema,
      multiplex,
    });
  } catch {
    sendJson(res, 500, { error: "뉴스를 불러오는 중 오류가 발생했습니다." });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  if (url.pathname === "/api/news") {
    handleNewsApi(res);
    return;
  }

  serveStatic(res, url.pathname);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`영화관 뉴스 앱: port ${PORT}`);
  console.log(`네이버 뉴스 API: ${isNaverConfigured() ? "사용" : "미설정"}`);
});
>>>>>>> 2a67fdf0ae6879c575e5dbb48f21503d93ed85cf
