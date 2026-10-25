/* Sift — a private image board. No framework, no build, no backend. */
(() => {
  "use strict";

  const STORAGE_KEY = "sift.v1";
  const VERSION = 1;
  const PAGE_SIZE = 20;
  const MAX_BOARDS = 200;
  const MAX_PINS_PER_BOARD = 5000;
  const PINTEREST_PIN_CAP = 5000;
  const MAX_SEEDS = 14;
  const FEED_LIMIT = 56;
  const API_BASE = "https://api.openverse.org/v1";
  const WIKI_API = "https://commons.wikimedia.org/w/api.php";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const icon = (name) =>
    `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;

  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);

  const cleanText = (value, max = 300) =>
    String(value ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);

  const nowIso = () => new Date().toISOString();

  const uid = () => {
    if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return "b_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  };

  function safeUrl(value) {
    const raw = String(value ?? "").trim();
    if (!/^https?:\/\//i.test(raw)) return "";
    try {
      const url = new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      return url.href;
    } catch {
      return "";
    }
  }

  function validIso(value, fallback) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
  }

  function titleCase(value) {
    const small = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);
    const words = cleanText(value, 80).split(" ").filter(Boolean);
    return words
      .map((word, index) => {
        const lower = word.toLowerCase();
        if (index > 0 && small.has(lower)) return lower;
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join(" ");
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const STOPWORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "been", "being", "but", "by", "can", "could",
    "did", "do", "does", "for", "from", "had", "has", "have", "he", "her", "here", "hers",
    "him", "his", "how", "i", "if", "in", "into", "is", "it", "its", "me", "more", "my",
    "no", "not", "of", "on", "one", "or", "our", "out", "she", "so", "some", "than", "that",
    "the", "their", "them", "then", "there", "these", "they", "this", "those", "to", "two",
    "up", "us", "was", "we", "were", "what", "when", "where", "which", "who", "why", "will",
    "with", "you", "your", "image", "images", "photo", "photos", "photograph", "photography",
    "picture", "pictures", "file", "files", "jpg", "jpeg", "png", "gif", "webp", "tif",
    "creative", "commons", "wikimedia", "flickr", "openverse", "license", "licence", "public",
    "domain", "cc", "by", "sa", "nc", "nd", "unknown", "untitled", "original", "work", "own",
  ]);

  function usefulSeed(value) {
    const seed = cleanText(value, 80).toLowerCase();
    if (seed.length < 3 || seed.length > 80) return false;
    if (!/[a-z]/.test(seed)) return false;
    if (STOPWORDS.has(seed)) return false;
    if (/^\d+$/.test(seed)) return false;
    return true;
  }

  function titleWords(title, limit = 6) {
    return cleanText(title, 200)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((word) => usefulSeed(word) && word.length > 2)
      .slice(0, limit);
  }

  /* ---------------------------------------------------------------------
     Persistent state
     --------------------------------------------------------------------- */

  function defaultState() {
    return { version: VERSION, boards: [], prefs: { theme: "auto" } };
  }

  function sanitizePin(raw) {
    if (typeof raw === "string") raw = { url: raw };
    if (!raw || typeof raw !== "object") return null;

    const url = safeUrl(raw.url);
    if (!url) return null;

    const thumb = safeUrl(raw.thumb) || url;
    const tags = Array.isArray(raw.tags)
      ? raw.tags.map((tag) => cleanText(tag, 40)).filter(Boolean).slice(0, 16)
      : [];
    const width = Number(raw.width);
    const height = Number(raw.height);

    return {
      url,
      thumb,
      title: cleanText(raw.title, 240) || "Untitled image",
      creator: cleanText(raw.creator, 160) || "Unknown",
      license: cleanText(raw.license, 100) || "See source",
      source: cleanText(raw.source, 80) || "Open web",
      foreignLandingUrl: safeUrl(raw.foreignLandingUrl) || "",
      openverseId: cleanText(raw.openverseId, 80) || "",
      provider: ["openverse", "wikimedia", "pinterest", "manual"].includes(raw.provider) ? raw.provider : "manual",
      width: Number.isFinite(width) && width > 0 && width <= 50000 ? Math.round(width) : 0,
      height: Number.isFinite(height) && height > 0 && height <= 50000 ? Math.round(height) : 0,
      tags,
      savedAt: validIso(raw.savedAt, nowIso()),
    };
  }

  function sanitizeBoardOrigin(raw) {
    if (!raw || typeof raw !== "object" || raw.provider !== "pinterest") return null;
    const boardId = cleanText(raw.boardId, 80);
    if (!boardId) return null;
    return {
      provider: "pinterest",
      boardId,
      username: normalizePinterestUsername(raw.username),
    };
  }

  function sanitizeSeedList(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const value of raw) {
      const seed = cleanText(value, 120);
      if (!usefulSeed(seed)) continue;
      if (out.some((existing) => existing.toLowerCase() === seed.toLowerCase())) continue;
      out.push(seed);
      if (out.length >= MAX_SEEDS) break;
    }
    return out;
  }

  function sanitizeState(raw) {
    const out = defaultState();
    if (!raw || typeof raw !== "object") return out;

    if (Array.isArray(raw.boards)) {
      const usedIds = new Set();
      for (const rawBoard of raw.boards.slice(0, MAX_BOARDS)) {
        if (!rawBoard || typeof rawBoard !== "object") continue;
        let id = cleanText(rawBoard.id, 80) || uid();
        if (usedIds.has(id)) id = uid();
        usedIds.add(id);

        const pins = [];
        if (Array.isArray(rawBoard.pins)) {
          for (const rawPin of rawBoard.pins.slice(0, MAX_PINS_PER_BOARD)) {
            const pin = sanitizePin(rawPin);
            if (!pin) continue;
            if (pins.some((existing) => existing.url === pin.url)) continue;
            pins.push(pin);
          }
        }

        out.boards.push({
          id,
          name: cleanText(rawBoard.name, 80) || "Untitled board",
          createdAt: validIso(rawBoard.createdAt, nowIso()),
          updatedAt: validIso(rawBoard.updatedAt, nowIso()),
          seeds: sanitizeSeedList(rawBoard.seeds),
          origin: sanitizeBoardOrigin(rawBoard.origin) || undefined,
          pins,
        });
      }
    }

    if (raw.prefs && ["auto", "light", "dusk"].includes(raw.prefs.theme)) {
      out.prefs.theme = raw.prefs.theme;
    }

    return out;
  }

  let storageAvailable = true;
  let bootNotice = "";
  let state = loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return sanitizeState(JSON.parse(raw));
    } catch (error) {
      bootNotice = "Your saved boards could not be read in this browser. Starting with a clean archive.";
      return defaultState();
    }
  }

  function persist(target = state, { quiet = false } = {}) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(target));
      storageAvailable = true;
      return true;
    } catch (error) {
      storageAvailable = false;
      if (!quiet) {
        showToast("This browser would not save your changes. They will last for this tab only.", {
          duration: 7000,
        });
      }
      return false;
    }
  }

  function allPins() {
    const out = [];
    for (const board of state.boards) {
      for (const pin of board.pins) {
        out.push({ ...pin, _boardId: board.id, _boardName: board.name });
      }
    }
    return out;
  }

  function boardById(id) {
    return state.boards.find((board) => board.id === id) || null;
  }

  function isSavedIn(boardId, url) {
    const board = boardById(boardId);
    return Boolean(board && board.pins.some((pin) => pin.url === url));
  }

  function isSavedAnywhere(url) {
    return state.boards.some((board) => board.pins.some((pin) => pin.url === url));
  }

  function addSeed(board, value) {
    const seed = cleanText(value, 120);
    if (!usefulSeed(seed)) return;
    if (board.seeds.some((existing) => existing.toLowerCase() === seed.toLowerCase())) return;
    board.seeds.push(seed);
    if (board.seeds.length > MAX_SEEDS) board.seeds = board.seeds.slice(-MAX_SEEDS);
  }

  function pinFromImage(image, fallbackTitle = "") {
    const pin = sanitizePin({
      ...image,
      title: image.title || fallbackTitle,
      savedAt: nowIso(),
    });
    return pin;
  }

  function addPinToBoard(boardId, image, sourceQuery = "") {
    const board = boardById(boardId);
    if (!board) return { ok: false, reason: "missing" };
    if (!image || !image.url) return { ok: false, reason: "invalid" };
    if (board.pins.some((pin) => pin.url === image.url)) {
      return { ok: false, reason: "duplicate", board };
    }

    const pin = pinFromImage(image);
    if (!pin) return { ok: false, reason: "invalid" };

    board.pins.unshift(pin);
    board.updatedAt = nowIso();

    if (sourceQuery) addSeed(board, sourceQuery);
    if (image.tags) {
      image.tags.filter(usefulSeed).slice(0, 3).forEach((tag) => addSeed(board, tag));
    }
    if (!board.seeds.length) {
      const words = titleWords(image.title, 4);
      if (words.length) addSeed(board, words.join(" "));
    }

    persist();
    imageCache.set(image.url, image);
    ui.dataVersion += 1;

    if (ui.feed.items.length) ui.feed.sig = feedSignature();
    if (ui.boardRelated.boardId === boardId) {
      ui.boardRelated.sig = boardRelatedSignature(board);
    }

    renderSidebar();
    syncSaveButtons(image.url);

    return { ok: true, board, pin };
  }

  function removePinFromBoard(boardId, url) {
    const board = boardById(boardId);
    if (!board) return null;
    const index = board.pins.findIndex((pin) => pin.url === url);
    if (index < 0) return null;

    const pin = board.pins[index];
    board.pins.splice(index, 1);
    board.updatedAt = nowIso();
    persist();
    ui.dataVersion += 1;

    if (ui.feed.items.length) ui.feed.sig = feedSignature();
    if (ui.boardRelated.boardId === boardId) {
      ui.boardRelated.sig = boardRelatedSignature(board);
    }

    renderSidebar();
    syncSaveButtons(url);

    return { board, pin, index };
  }

  /* ---------------------------------------------------------------------
     API — Openverse first, Wikimedia Commons as fallback
     --------------------------------------------------------------------- */

  class ApiError extends Error {
    constructor(message, status = 0) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }

  const searchCache = new Map();
  const relatedCache = new Map();
  const imageCache = new Map();
  const LOCAL_CACHE_LIMIT = 80;

  function cacheSet(cache, key, value) {
    cache.set(key, value);
    if (cache.size > LOCAL_CACHE_LIMIT) {
      cache.delete(cache.keys().next().value);
    }
  }

  function remember(image) {
    if (image && image.url) imageCache.set(image.url, image);
    return image;
  }

  function resolveImage(url) {
    if (!url) return null;
    if (imageCache.has(url)) return imageCache.get(url);
    for (const board of state.boards) {
      const found = board.pins.find((pin) => pin.url === url);
      if (found) {
        const image = remember({ ...found, boardId: board.id, boardName: board.name });
        return image;
      }
    }
    return null;
  }

  function licenseLabel(code) {
    const map = {
      by: "CC BY",
      "by-sa": "CC BY-SA",
      "by-nc": "CC BY-NC",
      "by-nc-sa": "CC BY-NC-SA",
      "by-nd": "CC BY-ND",
      "by-nc-nd": "CC BY-NC-ND",
      cc0: "CC0",
      pdm: "Public domain",
      "public-domain": "Public domain",
    };
    return map[String(code || "").toLowerCase()] || cleanText(code, 60) || "See source";
  }

  function sourceLabel(image) {
    const source = cleanText(image.source, 60);
    const map = {
      wikimedia: "Wikimedia Commons",
      openverse: "Openverse",
      pinterest: "Pinterest",
      flickr: "Flickr",
      manual: "Direct link",
    };
    return map[source.toLowerCase()] || source || "Open web";
  }

  async function getJson(url, signal) {
    const timeout = AbortSignal.timeout(16000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(url, {
      signal: combined,
      headers: { Accept: "application/json" },
      referrerPolicy: "no-referrer",
    });

    if (!response.ok) {
      let detail = "";
      try {
        const error = await response.json();
        detail = error.detail || error.error || "";
      } catch {
        /* ignore non-JSON errors */
      }
      if (response.status === 429) {
        throw new ApiError("rate limit", 429);
      }
      throw new ApiError(detail || `Request failed (${response.status})`, response.status);
    }

    return response.json();
  }

  function normalizeOpenverse(raw) {
    if (!raw || typeof raw !== "object") return null;
    const url = safeUrl(raw.url);
    if (!url) return null;
    const tags = Array.isArray(raw.tags)
      ? raw.tags.map((tag) => cleanText(tag && tag.name ? tag.name : tag, 40)).filter(Boolean).slice(0, 12)
      : [];

    return remember({
      provider: "openverse",
      openverseId: cleanText(raw.id, 80),
      url,
      thumb: safeUrl(raw.thumbnail) || url,
      title: cleanText(raw.title, 240) || "Untitled image",
      creator: cleanText(raw.creator, 160) || "Unknown",
      license: licenseLabel(raw.license),
      licenseUrl: safeUrl(raw.license_url) || "",
      source: cleanText(raw.source, 60) || "Openverse",
      foreignLandingUrl: safeUrl(raw.foreign_landing_url) || "",
      width: Number(raw.width) || 0,
      height: Number(raw.height) || 0,
      tags,
    });
  }

  async function openverseSearch(query, page, signal) {
    const params = new URLSearchParams({
      q: query,
      page: String(page),
      page_size: String(PAGE_SIZE),
      mature: "false",
      filter_dead: "true",
    });
    const data = await getJson(`${API_BASE}/images/?${params}`, signal);
    const items = (data.results || []).map(normalizeOpenverse).filter(Boolean);
    return {
      provider: "openverse",
      items,
      page: Number(data.page) || page,
      pageCount: Number(data.page_count) || page,
      total: Number(data.result_count) || items.length,
      notice: "",
    };
  }

  function stripHtml(value) {
    if (!value) return "";
    try {
      const doc = new DOMParser().parseFromString(String(value), "text/html");
      return cleanText(doc.body.textContent || "", 240);
    } catch {
      return cleanText(String(value).replace(/<[^>]*>/g, " "), 240);
    }
  }

  function normalizeWikimedia(page) {
    const info = page && page.imageinfo && page.imageinfo[0];
    if (!info) return null;
    const url = safeUrl(info.url);
    if (!url) return null;

    const meta = info.extmetadata || {};
    const rawTitle = cleanText(page.title, 220)
      .replace(/^File:\s*/i, "")
      .replace(/\.(jpe?g|png|gif|webp|tiff?|svg)$/i, "");
    const title = cleanText(rawTitle.replace(/_/g, " "), 240) || "Untitled image";
    const categories = Array.isArray(page.categories)
      ? page.categories.map((category) => cleanText(category.title, 40).replace(/^Category:\s*/i, ""))
      : [];
    const words = titleWords(title, 8);
    const tags = Array.from(new Set([...words, ...categories.filter(usefulSeed)])).slice(0, 12);

    return remember({
      provider: "wikimedia",
      openverseId: "",
      url,
      thumb: safeUrl(info.thumburl) || url,
      title,
      creator: stripHtml(meta.Artist && meta.Artist.value) || "Unknown",
      license: stripHtml(meta.LicenseShortName && meta.LicenseShortName.value) || "See source",
      licenseUrl: safeUrl(meta.LicenseUrl && meta.LicenseUrl.value) || "",
      source: "Wikimedia Commons",
      foreignLandingUrl: safeUrl(info.descriptionurl) || "",
      width: Number(info.width) || 0,
      height: Number(info.height) || 0,
      tags,
    });
  }

  async function wikimediaSearch(query, page, signal) {
    const params = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: query,
      gsrnamespace: "6",
      gsrlimit: String(PAGE_SIZE),
      gsroffset: String((page - 1) * PAGE_SIZE),
      prop: "imageinfo|categories",
      iiprop: "url|extmetadata|size",
      iiurlwidth: "800",
      iiextmetadatafilter: "LicenseShortName|Artist|Credit|LicenseUrl",
      cllimit: "12",
      format: "json",
      formatversion: "2",
      origin: "*",
    });
    const data = await getJson(`${WIKI_API}?${params}`, signal);
    const pages = data && data.query && Array.isArray(data.query.pages) ? data.query.pages : [];
    const items = pages.map(normalizeWikimedia).filter(Boolean);
    const total =
      data && data.query && data.query.searchinfo && Number(data.query.searchinfo.totalhits)
        ? Number(data.query.searchinfo.totalhits)
        : items.length;

    return {
      provider: "wikimedia",
      items,
      page,
      pageCount: data && data.continue ? page + 1 : page,
      total,
      notice: "Openverse is busy or rate-limiting. Showing results from Wikimedia Commons instead.",
    };
  }

  async function searchImages(query, page = 1, signal) {
    const key = `search:${query.toLowerCase()}:${page}`;
    if (searchCache.has(key)) return searchCache.get(key);

    try {
      const result = await openverseSearch(query, page, signal);
      cacheSet(searchCache, key, result);
      return result;
    } catch (error) {
      if (error.name === "AbortError" || (signal && signal.aborted)) throw error;
      const result = await wikimediaSearch(query, page, signal);
      cacheSet(searchCache, key, result);
      return result;
    }
  }

  async function relatedImages(image, signal) {
    if (!image || (!image.openverseId && !image.tags.length && !image.title)) return [];
    const key = image.openverseId ? `related:${image.openverseId}` : `related-search:${image.url}`;
    if (relatedCache.has(key)) return relatedCache.get(key);

    if (image.openverseId) {
      try {
        const params = new URLSearchParams({ page_size: String(PAGE_SIZE) });
        const url = `${API_BASE}/images/${encodeURIComponent(image.openverseId)}/related/?${params}`;
        const data = await getJson(url, signal);
        const items = (data.results || [])
          .map(normalizeOpenverse)
          .filter((item) => item && item.url !== image.url)
          .slice(0, 16);
        cacheSet(relatedCache, key, items);
        return items;
      } catch (error) {
        if (error.name === "AbortError" || (signal && signal.aborted)) throw error;
      }
    }

    const query = (image.tags.length ? image.tags.slice(0, 3) : titleWords(image.title, 4)).join(" ");
    if (!query) return [];
    try {
      const data = await searchImages(query, 1, signal);
      const items = data.items.filter((item) => item.url !== image.url).slice(0, 16);
      cacheSet(relatedCache, key, items);
      return items;
    } catch (error) {
      if (error.name === "AbortError") throw error;
      cacheSet(relatedCache, key, []);
      return [];
    }
  }

  /* ---------------------------------------------------------------------
     UI state
     --------------------------------------------------------------------- */

  const ui = {
    view: { name: "home" },
    dataVersion: 0,
    search: {
      token: 0,
      controller: null,
      query: "",
      items: [],
      page: 0,
      pageCount: 1,
      total: 0,
      loading: false,
      error: "",
      notice: "",
    },
    feed: {
      loading: false,
      items: [],
      seeds: [],
      sig: "",
      error: "",
      notice: "",
      anchor: null,
    },
    boardRelated: {
      boardId: "",
      loading: false,
      items: [],
      sig: "",
      error: "",
      notice: "",
      anchor: null,
      token: 0,
    },
    detail: {
      image: null,
      boardId: "",
      related: [],
      loading: false,
      error: "",
      token: 0,
    },
    saveImage: null,
    savePreferredBoard: "",
    boardDialog: {
      mode: "create",
      boardId: "",
      pendingImage: null,
      stay: false,
      seed: "",
    },
    linkBoardId: "",
    toastTimer: 0,
    toastAction: null,
    lastQuery: "",
  };

  /* ---------------------------------------------------------------------
     Theme
     --------------------------------------------------------------------- */

  const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");

  function resolvedTheme() {
    if (state.prefs.theme === "auto") return themeMedia.matches ? "dusk" : "light";
    return state.prefs.theme;
  }

  function applyTheme() {
    const theme = resolvedTheme();
    document.documentElement.dataset.theme = theme;
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dusk" ? "#151712" : "#f2eee4");

    const use = $("#themeBtn use");
    if (use) use.setAttribute("href", theme === "dusk" ? "#i-sun" : "#i-moon");
    const button = $("#themeBtn");
    if (button) {
      button.setAttribute(
        "aria-label",
        theme === "dusk" ? "Switch to day theme" : "Switch to dusk theme"
      );
      button.title = theme === "dusk" ? "Switch to day theme" : "Switch to dusk theme";
    }

    $$("[data-theme-choice]").forEach((choice) => {
      choice.classList.toggle("is-active", choice.dataset.themeChoice === state.prefs.theme);
      choice.setAttribute("aria-pressed", String(choice.dataset.themeChoice === state.prefs.theme));
    });
  }

  function chooseTheme(theme) {
    state.prefs.theme = ["auto", "light", "dusk"].includes(theme) ? theme : "auto";
    persist();
    applyTheme();
  }

  /* ---------------------------------------------------------------------
     Rendering helpers
     --------------------------------------------------------------------- */

  function swatchFor(id) {
    const colors = ["#365a43", "#b25e44", "#a58136", "#60718a", "#7d5f78", "#65724e", "#8b6241"];
    let sum = 0;
    for (const char of String(id)) sum += char.charCodeAt(0);
    return colors[sum % colors.length];
  }

  function ratioFor(image) {
    const width = Number(image.width) || 0;
    const height = Number(image.height) || 0;
    if (!width || !height) return "0.8";
    const ratio = Math.min(1.68, Math.max(0.56, width / height));
    return ratio.toFixed(4);
  }

  function saveButtonHTML(image, boardId = "") {
    const saved = boardId ? isSavedIn(boardId, image.url) : isSavedAnywhere(image.url);
    return `<button class="save-btn${saved ? " is-saved" : ""}" type="button" data-action="save" data-url="${esc(
      image.url
    )}" data-board-id="${esc(boardId)}" aria-label="${saved ? "Saved" : "Save"} ${esc(
      image.title
    )}">${icon(saved ? "check" : "bookmark")}<span>${saved ? "Saved" : "Save"}</span></button>`;
  }

  function pinCardHTML(image, options = {}) {
    if (!image || !image.url) return "";
    remember(image);
    const boardId = options.boardId || image._boardId || "";
    const boardName = options.boardName || image._boardName || "";
    const showSave = options.showSave !== false;
    const showBoard = Boolean(boardName && options.showBoard);
    const src = safeUrl(image.thumb) || image.url;
    const fallback = src !== image.url ? image.url : "";
    const meta = [image.creator, image.license].filter(Boolean).join(" · ");
    const tag = showBoard
      ? `<span class="board-tag" title="${esc(boardName)}">${esc(boardName)}</span>`
      : "";

    return `<article class="pin-card reveal" data-url="${esc(image.url)}">
      <div class="pin-media" style="aspect-ratio:${ratioFor(image)}">
        <button class="pin-open" type="button" data-action="open-pin" data-url="${esc(
          image.url
        )}" data-board-id="${esc(boardId)}" aria-label="Open ${esc(image.title)}">
          <img src="${esc(src)}" alt="${esc(image.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"${
            fallback ? ` data-fallback="${esc(fallback)}"` : ""
          }>
        </button>
        <span class="source-flag">${esc(sourceLabel(image))}</span>
        ${showSave ? `<span class="pin-actions">${saveButtonHTML(image, boardId)}</span>` : ""}
      </div>
      ${tag}
      <div class="pin-caption">
        <span class="pin-caption-text">
          <span class="pin-title">${esc(image.title || "Untitled image")}</span>
          <span class="pin-meta">${esc(meta || "Saved link")}</span>
        </span>
        ${icon("bookmark")}
      </div>
    </article>`;
  }

  function masonryHTML(items, options = {}) {
    const seen = new Set();
    const cards = [];
    for (const item of items) {
      if (!item || !item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      cards.push(
        pinCardHTML(item, {
          boardId: options.boardId || "",
          showSave: options.showSave,
          showBoard: options.showBoard,
          boardName: item._boardName || options.boardName || "",
        })
      );
    }
    return `<div class="masonry">${cards.join("")}</div>`;
  }

  function skeletonHTML(count = 8, compact = false) {
    const ratios = [0.74, 1.2, 0.86, 0.7, 1.38, 0.8, 1.08, 0.66, 1.52, 0.9, 0.72, 1.15];
    return `<div class="masonry" aria-hidden="true">${Array.from(
      { length: count },
      (_, index) =>
        `<div class="skeleton-card" style="aspect-ratio:${ratios[index % ratios.length]}${
          compact ? ";min-height:150px" : ""
        }"></div>`
    ).join("")}</div>`;
  }

  function noticeHTML(message) {
    if (!message) return "";
    return `<div class="notice">${icon("spark")}<span>${esc(message)}</span></div>`;
  }

  function brandMarkSVG() {
    return `<svg class="empty-mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2.5v27M2.5 16h27M6.5 6.5l19 19M25.5 6.5l-19 19"/>
      <circle cx="16" cy="16" r="3.1"/>
    </svg>`;
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 5) return "Still awake, collector";
    if (hour < 12) return "Good morning, collector";
    if (hour < 17) return "Good afternoon, collector";
    if (hour < 22) return "Good evening, collector";
    return "Late light, collector";
  }

  function specimenHTML() {
    return `<div class="specimen" aria-hidden="true">
      <div class="specimen-card a">
        <span class="specimen-tack"></span>
        <span class="specimen-label">Study no. 12<br>Late fall</span>
        <svg class="botanical botanical-a" viewBox="0 0 300 380">
          <path d="M143 373C144 315 148 270 160 228c14-48 34-87 63-126"/>
          <path class="leaf" d="M150 330c-31-9-53-33-57-64 35 4 58 28 57 64Z"/>
          <path class="leaf" d="M160 284c32-11 56-35 61-67-36 4-61 30-61 67Z"/>
          <path class="leaf" d="M171 238c-28-10-47-32-50-59 32 4 53 27 50 59Z"/>
          <path class="leaf" d="M183 190c29-10 50-32 54-60-31 3-55 27-54 60Z"/>
          <path class="leaf" d="M197 145c-23-8-38-27-40-50 26 4 42 22 40 50Z"/>
          <path d="M213 111c17-11 32-28 42-47"/>
          <circle cx="158" cy="228" r="1.8"/>
          <circle cx="181" cy="190" r="1.8"/>
        </svg>
        <span class="specimen-no">SIFT / 012</span>
      </div>
      <div class="specimen-card b">
        <span class="specimen-label">Moss / fog / field<br>Collected quietly</span>
        <svg class="botanical botanical-b" viewBox="0 0 280 360">
          <path d="M30 337C97 275 158 213 234 99"/>
          <path class="leaf" d="M93 286c-6-39 10-74 47-99 8 38-11 76-47 99Z"/>
          <path class="leaf" d="M126 241c38-2 70 16 88 48-36 12-72-5-88-48Z"/>
          <path class="leaf" d="M159 195c-7-32 7-61 37-82 8 31-8 63-37 82Z"/>
          <path class="leaf" d="M187 153c31-2 58 13 74 40-30 10-60-4-74-40Z"/>
          <circle cx="213" cy="115" r="2"/>
        </svg>
        <span class="specimen-no">SIFT / 018</span>
      </div>
      <div class="specimen-card c">
        <div class="specimen-copy">
          <strong>A place for what you notice.</strong>
          <small>Local / private<br>no ads, no account</small>
        </div>
      </div>
    </div>`;
  }

  function emptyHeroHTML() {
    const suggestions = ["mossy forest", "quiet architecture", "botanical study", "night swimming", "handmade ceramics", "fog at dawn"];
    return `<section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">${esc(greeting())}</p>
        <h1>Keep what <em>catches</em> your eye.</h1>
        <p class="hero-lead">A private image board for the open web. Search for something that interests you, save only the links, and let Sift grow a quiet feed from what you keep.</p>
        <form class="hero-search" data-search-form>
          <label class="sr-only" for="heroSearchInput">Search for images</label>
          ${icon("search")}
          <input id="heroSearchInput" name="q" type="search" placeholder="Try “mossy forest”" autocomplete="off" spellcheck="false">
          <button type="submit">Search</button>
        </form>
        <div class="search-suggestions">
          <span>Begin with</span>
          ${suggestions
            .map((suggestion) => `<button class="chip" type="button" data-search="${esc(suggestion)}">${esc(suggestion)}</button>`)
            .join("")}
        </div>
        <div class="hero-footnote">
          <span>No account</span>
          <span>No ads</span>
          <span>No tracking</span>
          <span>Links only</span>
        </div>
      </div>
      ${specimenHTML()}
    </section>`;
  }

  /* ---------------------------------------------------------------------
     Sidebar + shell rendering
     --------------------------------------------------------------------- */

  function renderSidebar() {
    const list = $("#boardList");
    if (!list) return;
    const totalPins = allPins().length;
    const allCount = $("#allCount");
    if (allCount) allCount.textContent = String(totalPins);

    if (!state.boards.length) {
      list.innerHTML = "";
    } else {
      list.innerHTML = state.boards
        .map(
          (board) => `<li>
            <button class="board-item" type="button" data-nav="board" data-board-id="${esc(board.id)}">
              <span class="board-swatch" style="--swatch:${swatchFor(board.id)}"></span>
              <span class="board-name">${esc(board.name)}</span>
              <span class="nav-count">${board.pins.length}</span>
            </button>
          </li>`
        )
        .join("");
    }
    updateSidebarState();
  }

  function updateSidebarState() {
    $$(".nav-item").forEach((item) => {
      const isActive =
        (item.dataset.nav === "home" && ui.view.name === "home") ||
        (item.dataset.nav === "all" && ui.view.name === "all");
      item.classList.toggle("is-active", isActive);
      if (isActive) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });

    $$(".board-item").forEach((item) => {
      const isActive = ui.view.name === "board" && item.dataset.boardId === ui.view.boardId;
      item.classList.toggle("is-active", isActive);
      if (isActive) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }

  function setSearchInputs(value) {
    const header = $("#searchInput");
    if (header) header.value = value;
    const hero = $("#heroSearchInput");
    if (hero) hero.value = value;
  }

  function closeMobileNav() {
    document.body.classList.remove("nav-open");
    const menu = $("#menuBtn");
    if (menu) menu.setAttribute("aria-expanded", "false");
    const scrim = $("#scrim");
    if (scrim) scrim.hidden = true;
  }

  function openMobileNav() {
    document.body.classList.add("nav-open");
    const menu = $("#menuBtn");
    if (menu) menu.setAttribute("aria-expanded", "true");
    const scrim = $("#scrim");
    if (scrim) scrim.hidden = false;
    const close = $("#sidebarClose");
    if (close) close.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------------------
     Home
     --------------------------------------------------------------------- */

  function feedSignature() {
    return state.boards
      .map((board) => `${board.id}:${board.pins.length}:${board.seeds.join(",")}`)
      .join("|");
  }

  function buildInterestProfile(boards = state.boards) {
    const scores = new Map();
    const bump = (value, weight) => {
      const seed = cleanText(value, 80).toLowerCase();
      if (!usefulSeed(seed)) return;
      scores.set(seed, (scores.get(seed) || 0) + weight);
    };

    for (const board of boards) {
      for (const seed of board.seeds) bump(seed, 3);
      const boardWords = titleWords(board.name, 4);
      boardWords.forEach((word) => bump(word, 1));
      for (const pin of board.pins.slice(0, 60)) {
        (pin.tags || []).forEach((tag) => bump(tag, 2));
        titleWords(pin.title, 4).forEach((word) => bump(word, 1));
      }
    }

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([seed]) => seed);
  }

  function feedBodyHTML() {
    if (ui.feed.error) {
      return `<div class="load-error">
        <h3>The trail went cold.</h3>
        <p>${esc(ui.feed.error)}</p>
        <button class="btn btn-quiet btn-small" type="button" data-action="retry-feed">${icon("shuffle")}Try again</button>
      </div>`;
    }

    if (ui.feed.loading && !ui.feed.items.length) {
      return `<div class="loading-copy" style="margin-bottom:18px">Gathering a few quiet things</div>${skeletonHTML(9)}`;
    }

    if (!ui.feed.items.length) {
      return `<div class="empty-panel">
        <div class="empty-inner">
          ${brandMarkSVG()}
          <h2>No suggestions yet.</h2>
          <p>Save an image or add a seed to a board. Sift will use those clues to find more of the same.</p>
          <div class="empty-actions">
            <button class="btn btn-primary" type="button" data-search="${esc(ui.feed.seeds[0] || "quiet places")}">Search for images</button>
          </div>
        </div>
      </div>`;
    }

    return masonryHTML(ui.feed.items, { showSave: true });
  }

  function feedSectionHTML() {
    return `<section>
      <div class="section-head">
        <div>
          <p class="eyebrow">From your orbit</p>
          <h2>More like what you kept.</h2>
          <p>Related images drawn from your boards and saved links. Nothing here is saved until you choose it.</p>
          ${
            ui.feed.seeds.length
              ? `<div class="seed-row">${ui.feed.seeds
                  .slice(0, 6)
                  .map((seed) => `<span class="seed-chip">${esc(seed)}</span>`)
                  .join("")}</div>`
              : ""
          }
        </div>
        <div class="section-actions">
          <button class="icon-action" type="button" data-action="refresh-feed" ${
            ui.feed.loading ? "disabled" : ""
          }>${icon("shuffle")}Shuffle</button>
        </div>
      </div>
      ${noticeHTML(ui.feed.notice)}
      ${feedBodyHTML()}
    </section>`;
  }

  function renderHome() {
    const pins = allPins();
    if (!pins.length) {
      $("#view").innerHTML = `<div class="view-inner">${emptyHeroHTML()}</div>`;
      document.title = "Sift — a private image board";
      return;
    }

    $("#view").innerHTML = `<div class="view-inner">
      <section class="home-intro">
        <div>
          <p class="eyebrow greeting">${esc(greeting())}</p>
          <h1 class="view-title">Your eye, <em>on file.</em></h1>
          <p class="view-sub">A feed assembled from the things you chose, not the things an algorithm wants to sell you. Keep it, shuffle it, or leave it be.</p>
        </div>
        <div class="home-stat">
          <strong>${pins.length}</strong>
          <span>link${pins.length === 1 ? "" : "s"} kept<br>across ${state.boards.length} board${state.boards.length === 1 ? "" : "s"}</span>
        </div>
      </section>
      ${feedSectionHTML()}
    </div>`;
    document.title = "Sift — your field";
  }

  async function loadHomeFeed(force = false) {
    if (ui.feed.loading) return;
    const signature = feedSignature();

    if (!force && ui.feed.items.length && ui.feed.sig === signature && !ui.feed.error) return;

    ui.feed.loading = true;
    ui.feed.error = "";
    ui.feed.notice = "";
    ui.feed.sig = signature;
    if (force) {
      ui.feed.items = [];
      ui.feed.seeds = [];
      if (ui.view.name === "home") render();
    }

    const profile = buildInterestProfile();
    const seeds = profile.length ? profile : state.boards.flatMap((board) => board.seeds).slice(0, 4);
    ui.feed.seeds = seeds.slice(0, 6);

    const savedUrls = new Set(allPins().map((pin) => pin.url));
    const anchor = allPins()
      .filter((pin) => pin.openverseId)
      .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))[0] || null;
    ui.feed.anchor = anchor ? anchor.url : null;

    const tasks = [];
    if (anchor) {
      tasks.push(
        relatedImages(anchor).catch((error) => {
          if (error.name === "AbortError") throw error;
          return [];
        })
      );
    }
    for (const seed of seeds.slice(0, anchor ? 2 : 3)) {
      tasks.push(searchImages(seed).then((result) => result.items).catch(() => []));
    }

    if (!tasks.length) {
      ui.feed.loading = false;
      ui.feed.error = "Add a seed to a board or save an image to begin the feed.";
      if (ui.view.name === "home") render();
      return;
    }

    try {
      const settled = await Promise.allSettled(tasks);
      const notices = [];
      const items = [];
      let anySuccess = false;

      for (const result of settled) {
        if (result.status !== "fulfilled") continue;
        anySuccess = true;
        if (result.value && result.value.notice) notices.push(result.value.notice);
        if (Array.isArray(result.value)) {
          items.push(...result.value);
        } else if (Array.isArray(result.value.items)) {
          items.push(...result.value.items);
        }
      }

      const seen = new Set();
      ui.feed.items = items
        .filter((item) => {
          if (!item || !item.url || savedUrls.has(item.url) || seen.has(item.url)) return false;
          seen.add(item.url);
          return true;
        })
        .slice(0, FEED_LIMIT);

      if (notices.length) ui.feed.notice = Array.from(new Set(notices)).join(" ");
      if (!anySuccess) {
        ui.feed.error = "Sift could not reach the image sources. Check your connection and try again.";
      } else if (!ui.feed.items.length) {
        ui.feed.error = "The image sources had nothing new for these seeds. Try a different search or save another image.";
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        ui.feed.error = "Sift could not reach the image sources. Check your connection and try again.";
      }
    } finally {
      ui.feed.loading = false;
      if (ui.view.name === "home") render();
    }
  }

  function refreshFeed() {
    ui.feed.items = [];
    ui.feed.sig = "";
    ui.feed.error = "";
    ui.feed.loading = false;
    render();
  }

  /* ---------------------------------------------------------------------
     Search
     --------------------------------------------------------------------- */

  function renderSearch() {
    const data = ui.search;
    const resultCount = data.total || data.items.length;
    const hasResults = data.items.length > 0;

    $("#view").innerHTML = `<div class="view-inner">
      <header class="search-view-head">
        <div>
          <p class="eyebrow">Search the open web</p>
          <h1 class="view-title"><em>“${esc(data.query)}”</em></h1>
          <div class="search-context" aria-live="polite">
            ${
              data.loading && !hasResults
                ? `<span>Searching Openverse</span>`
                : `<span>${resultCount.toLocaleString()} image${resultCount === 1 ? "" : "s"}</span><span>Openly licensed</span><span>No search history</span>`
            }
          </div>
        </div>
        <div class="results-tools">
          <button class="btn btn-primary" type="button" data-action="start-board" data-query="${esc(
            data.query
          )}">${icon("plus")}Start a board from this</button>
        </div>
      </header>
      ${noticeHTML(data.notice)}
      ${
        data.error
          ? `<div class="load-error" style="margin-top:26px">
              <h3>The search came back empty-handed.</h3>
              <p>${esc(data.error)}</p>
              <button class="btn btn-quiet btn-small" type="button" data-action="retry-search">${icon("search")}Try again</button>
            </div>`
          : ""
      }
      ${
        data.loading && !hasResults
          ? `<div style="margin-top:26px"><div class="loading-copy" style="margin-bottom:18px">Searching the open collections</div>${skeletonHTML(
              11
            )}</div>`
          : ""
      }
      ${
        !data.loading && !data.error && !hasResults
          ? `<div class="empty-panel" style="margin-top:26px">
              <div class="empty-inner">
                ${brandMarkSVG()}
                <h2>Nothing surfaced.</h2>
                <p>Try a broader phrase, a material, a mood, or a place. Openverse searches titles, descriptions, and tags.</p>
                <div class="empty-actions">
                  <button class="btn btn-quiet" type="button" data-search="${esc(data.query)}">Search again</button>
                </div>
              </div>
            </div>`
          : ""
      }
      ${hasResults ? `<div style="margin-top:26px">${masonryHTML(data.items, { showSave: true })}</div>` : ""}
      ${
        hasResults && (data.page < data.pageCount || data.loading)
          ? `<div class="load-more-wrap">
              <button class="btn btn-quiet" type="button" data-action="load-more" ${
                data.loading ? "disabled" : ""
              }>${data.loading ? "Searching…" : "Load more images"}</button>
            </div>`
          : ""
      }
    </div>`;
    document.title = `${data.query} — Sift`;
  }

  async function performSearch(rawQuery, options = {}) {
    const query = cleanText(rawQuery, 180).replace(/\s+/g, " ");
    if (!query) return;

    const append = Boolean(options.append);
    if (append && (ui.search.loading || ui.search.page >= ui.search.pageCount)) return;

    if (!append) {
      ui.search.controller?.abort();
      ui.search.controller = new AbortController();
      ui.search = {
        token: ui.search.token + 1,
        controller: ui.search.controller,
        query,
        items: [],
        page: 0,
        pageCount: 1,
        total: 0,
        loading: true,
        error: "",
        notice: "",
      };
      ui.lastQuery = query;
      ui.view = { name: "search", query };
      setSearchInputs(query);
      window.scrollTo({ top: 0, behavior: "auto" });
      render();
    } else {
      ui.search.loading = true;
      render();
    }

    const token = ui.search.token;
    try {
      const result = await searchImages(query, ui.search.page + 1, ui.search.controller.signal);
      if (token !== ui.search.token) return;

      const existing = new Set(ui.search.items.map((item) => item.url));
      const incoming = result.items.filter((item) => !existing.has(item.url));
      ui.search.items = append ? [...ui.search.items, ...incoming] : result.items;
      ui.search.page = result.page;
      ui.search.pageCount = result.pageCount;
      ui.search.total = append ? ui.search.total || result.total : result.total;
      ui.search.notice = result.notice || "";
      ui.search.loading = false;
      ui.search.error = "";
    } catch (error) {
      if (error.name === "AbortError") return;
      if (token !== ui.search.token) return;
      ui.search.loading = false;
      ui.search.error =
        error.status === 429
          ? "Both image sources are limiting requests right now. Wait a minute, then try again."
          : "Check your connection and try again. The search request did not complete.";
    }

    if (ui.view.name === "search" && ui.view.query === query) render();
  }

  /* ---------------------------------------------------------------------
     All saved
     --------------------------------------------------------------------- */

  function renderAllSaved() {
    const pins = allPins().sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));

    $("#view").innerHTML = `<div class="view-inner">
      <header class="board-head">
        <div class="board-title-row">
          <div class="board-title-wrap">
            <p class="eyebrow">Everything kept</p>
            <h1 class="view-title">Your <em>whole</em> archive.</h1>
            <div class="board-sub">
              <span>${pins.length} image link${pins.length === 1 ? "" : "s"}</span>
              <span class="dot"></span>
              <span>${state.boards.length} board${state.boards.length === 1 ? "" : "s"}</span>
              <span class="dot"></span>
              <span>Stored in this browser</span>
            </div>
          </div>
          <div class="board-tools">
            <button class="btn btn-quiet" type="button" data-action="export">${icon("download")}Export JSON</button>
          </div>
        </div>
      </header>
      ${
        pins.length
          ? `<div class="board-pins">${masonryHTML(pins, { showSave: false, showBoard: true })}</div>`
          : `<div class="empty-panel" style="margin-top:28px">
              <div class="empty-inner">
                ${brandMarkSVG()}
                <h2>An empty archive.</h2>
                <p>Search for something and save your first link. The JSON stays here, in this browser.</p>
                <div class="empty-actions">
                  <button class="btn btn-primary" type="button" data-action="focus-search">${icon("search")}Search for images</button>
                </div>
              </div>
            </div>`
      }
    </div>`;
    document.title = "All saved — Sift";
  }

  /* ---------------------------------------------------------------------
     Board
     --------------------------------------------------------------------- */

  function boardRelatedSignature(board) {
    return `${board.id}:${board.pins.length}:${board.seeds.join(",")}`;
  }

  function boardRelatedBodyHTML() {
    if (ui.boardRelated.error) {
      return `<div class="load-error">
        <h3>No related trail this time.</h3>
        <p>${esc(ui.boardRelated.error)}</p>
        <button class="btn btn-quiet btn-small" type="button" data-action="retry-board-related">${icon("shuffle")}Try again</button>
      </div>`;
    }
    if (ui.boardRelated.loading && !ui.boardRelated.items.length) {
      return `<div class="loading-copy" style="margin-bottom:18px">Looking for kindred images</div>${skeletonHTML(6)}`;
    }
    if (!ui.boardRelated.items.length) {
      return `<div class="empty-panel" style="min-height:250px">
        <div class="empty-inner">
          <h2>Nothing close by yet.</h2>
          <p>Save a search result or add a seed to this board, then ask again.</p>
        </div>
      </div>`;
    }
    return masonryHTML(ui.boardRelated.items, {
      showSave: true,
      boardId: ui.view.boardId,
      showBoard: false,
    });
  }

  function renderBoard() {
    const board = boardById(ui.view.boardId);
    if (!board) {
      $("#view").innerHTML = `<div class="view-inner">
        <div class="empty-panel">
          <div class="empty-inner">
            ${brandMarkSVG()}
            <h2>This board is gone.</h2>
            <p>It may have been removed in another tab.</p>
            <div class="empty-actions"><button class="btn btn-primary" type="button" data-nav="home">Return to the field</button></div>
          </div>
        </div>
      </div>`;
      document.title = "Board not found — Sift";
      return;
    }

    const pins = [...board.pins].sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    const canFindRelated = pins.length > 0 || board.seeds.length > 0;

    $("#view").innerHTML = `<div class="view-inner">
      <header class="board-head">
        <div class="board-title-row">
          <div class="board-title-wrap">
            <p class="eyebrow">A board from your archive</p>
            <h1 class="view-title">${esc(board.name)}</h1>
            <div class="board-sub">
              <span>${pins.length} image link${pins.length === 1 ? "" : "s"}</span>
              <span class="dot"></span>
              <span>Kept ${new Date(board.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
              <span class="dot"></span>
              <span>Private to this browser</span>
            </div>
            ${
              board.seeds.length
                ? `<div class="seed-row">${board.seeds
                    .slice(0, 12)
                    .map((seed) => `<span class="seed-chip">${esc(seed)}</span>`)
                    .join("")}</div>`
                : ""
            }
          </div>
          <div class="board-tools">
            <button class="btn btn-quiet" type="button" data-action="add-link" data-board-id="${esc(board.id)}">${icon("link")}Add link</button>
            <button class="btn btn-quiet" type="button" data-action="find-related" ${
              canFindRelated ? "" : "disabled"
            }>${icon("spark")}Find related</button>
            <div class="board-menu-wrap">
              <button class="icon-btn" type="button" data-action="board-menu" aria-label="Board options" aria-expanded="false">${icon("more")}</button>
              <div class="menu-popover" hidden>
                <button type="button" data-action="rename-board">${icon("edit")}Rename board</button>
                <button type="button" class="is-danger" data-action="delete-board">${icon("trash")}Delete board</button>
              </div>
            </div>
          </div>
        </div>
      </header>

      ${
        pins.length
          ? `<div class="board-pins">${masonryHTML(pins, { showSave: false, boardId: board.id })}</div>`
          : `<div class="empty-panel" style="margin-top:28px">
              <div class="empty-inner">
                ${brandMarkSVG()}
                <h2>This board is a blank page.</h2>
                <p>Start with a search${board.seeds.length ? ` for “${esc(board.seeds[0])}”` : ""}, or paste a direct image link you already have.</p>
                <div class="empty-actions">
                  <button class="btn btn-primary" type="button" data-search="${esc(board.seeds[0] || board.name)}">${icon("search")}Search for images</button>
                  <button class="btn btn-quiet" type="button" data-action="add-link" data-board-id="${esc(board.id)}">${icon("link")}Add a link</button>
                </div>
              </div>
            </div>`
      }

      <section id="board-related" style="margin-top:10px">
        <div class="section-head">
          <div>
            <p class="eyebrow">In the same vein</p>
            <h2>More like this board.</h2>
            <p>Suggested from this board's seeds and saved images. Save anything that belongs here.</p>
          </div>
          <div class="section-actions">
            <button class="icon-action" type="button" data-action="refresh-board-related" ${
              ui.boardRelated.loading ? "disabled" : ""
            }>${icon("shuffle")}Shuffle</button>
          </div>
        </div>
        ${noticeHTML(ui.boardRelated.notice)}
        ${boardRelatedBodyHTML()}
      </section>
    </div>`;
    document.title = `${board.name} — Sift`;
  }

  async function loadBoardRelated(force = false) {
    const board = boardById(ui.view.boardId);
    if (!board) return;
    if (ui.boardRelated.loading && ui.boardRelated.boardId === board.id) return;

    const signature = boardRelatedSignature(board);
    if (!force && ui.boardRelated.boardId === board.id && ui.boardRelated.items.length && ui.boardRelated.sig === signature) {
      return;
    }

    if (force || ui.boardRelated.boardId !== board.id) {
      ui.boardRelated.items = [];
      ui.boardRelated.error = "";
    }

    const token = ui.boardRelated.token + 1;
    ui.boardRelated.token = token;
    ui.boardRelated.boardId = board.id;
    ui.boardRelated.loading = true;
    ui.boardRelated.sig = signature;
    ui.boardRelated.notice = "";
    if (ui.view.name === "board" && ui.view.boardId === board.id) render();

    const seeds = [...board.seeds];
    if (!seeds.length) {
      const profile = buildInterestProfile([board]);
      seeds.push(...profile);
    }
    if (!seeds.length) seeds.push(titleCase(board.name));

    const savedUrls = new Set(allPins().map((pin) => pin.url));
    const anchor = [...board.pins]
      .filter((pin) => pin.openverseId)
      .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))[0] || null;
    ui.boardRelated.anchor = anchor ? anchor.url : null;

    const tasks = [];
    if (anchor) tasks.push(relatedImages(anchor).catch(() => []));
    for (const seed of seeds.slice(0, anchor ? 2 : 3)) {
      tasks.push(searchImages(seed).then((result) => result.items).catch(() => []));
    }

    try {
      const settled = await Promise.allSettled(tasks);
      if (token !== ui.boardRelated.token) return;
      const items = [];
      const notices = [];
      for (const result of settled) {
        if (result.status !== "fulfilled" || !result.value) continue;
        if (result.value.notice) notices.push(result.value.notice);
        if (Array.isArray(result.value)) items.push(...result.value);
      }

      const seen = new Set();
      ui.boardRelated.items = items
        .filter((item) => {
          if (!item || !item.url || savedUrls.has(item.url) || seen.has(item.url)) return false;
          seen.add(item.url);
          return true;
        })
        .slice(0, 28);
      ui.boardRelated.notice = Array.from(new Set(notices)).join(" ");
      ui.boardRelated.error = "";
    } catch (error) {
      if (token !== ui.boardRelated.token) return;
      ui.boardRelated.error = "The image sources did not answer. Try again in a moment.";
    } finally {
      if (token !== ui.boardRelated.token) return;
      ui.boardRelated.loading = false;
      if (ui.view.name === "board" && ui.view.boardId === board.id) render();
    }
  }

  /* ---------------------------------------------------------------------
     Detail dialog
     --------------------------------------------------------------------- */

  function detailRelatedHTML() {
    if (ui.detail.loading) {
      return `<div class="related-empty">Looking for related images…</div>`;
    }
    if (ui.detail.error) {
      return `<div class="related-empty">${esc(ui.detail.error)}</div>`;
    }
    if (!ui.detail.related.length) {
      return `<div class="related-empty">No close relatives surfaced. Try a search with a broader phrase.</div>`;
    }
    return `<div class="related-grid">${ui.detail.related
      .slice(0, 12)
      .map(
        (image) => `<button class="related-card" type="button" data-action="open-related" data-url="${esc(
          image.url
        )}" aria-label="Open ${esc(image.title)}">
          <img src="${esc(safeUrl(image.thumb) || image.url)}" alt="${esc(
          image.title
        )}" loading="lazy" decoding="async" referrerpolicy="no-referrer"${
          safeUrl(image.thumb) !== image.url ? ` data-fallback="${esc(image.url)}"` : ""
        }>
        </button>`
      )
      .join("")}</div>`;
  }

  function renderDetail() {
    const image = ui.detail.image;
    if (!image) return;
    remember(image);

    const board = ui.detail.boardId ? boardById(ui.detail.boardId) : null;
    const savedHere = board ? isSavedIn(board.id, image.url) : false;
    const savedAnywhere = isSavedAnywhere(image.url);
    const src = safeUrl(image.thumb) || image.url;
    const dimensions =
      image.width && image.height ? `${image.width} × ${image.height}` : "Not recorded";

    $("#detailInner").innerHTML = `
      <div class="detail-top">
        <div class="detail-media">
          <img src="${esc(src)}" alt="${esc(image.title)}" decoding="async" referrerpolicy="no-referrer"${
            src !== image.url ? ` data-fallback="${esc(image.url)}"` : ""
          }>
        </div>
        <div class="detail-side">
          <button class="icon-btn dialog-close" type="button" data-close aria-label="Close">
            ${icon("x")}
          </button>
          <div class="detail-side-head">
            <p class="eyebrow">${esc(sourceLabel(image))} · ${esc(image.license || "See source")}</p>
            <h2 id="detailTitle">${esc(image.title || "Untitled image")}</h2>
            <p class="detail-creator">${esc(image.creator || "Unknown creator")}${
              board ? ` · kept in ${esc(board.name)}` : ""
            }</p>
            ${
              image.tags && image.tags.length
                ? `<div class="detail-tags">${image.tags
                    .slice(0, 8)
                    .map((tag) => `<span>${esc(tag)}</span>`)
                    .join("")}</div>`
                : ""
            }
          </div>

          <div class="detail-actions">
            <button class="btn btn-primary" type="button" data-action="detail-save" data-url="${esc(
              image.url
            )}">${icon(savedAnywhere ? "check" : "bookmark")}${
              board ? (savedHere ? "Saved here" : "Save here") : savedAnywhere ? "Save elsewhere" : "Save"
            }</button>
            <a class="btn btn-quiet" href="${esc(image.url)}" target="_blank" rel="noopener noreferrer">${icon(
              "external"
            )}Open image</a>
            ${
              image.foreignLandingUrl
                ? `<a class="btn btn-quiet" href="${esc(
                    image.foreignLandingUrl
                  )}" target="_blank" rel="noopener noreferrer">${icon("link")}Source page</a>`
                : ""
            }
          </div>

          <dl class="detail-meta">
            <div><dt>License</dt><dd>${esc(image.license || "See source")}</dd></div>
            <div><dt>Source</dt><dd>${esc(sourceLabel(image))}</dd></div>
            <div><dt>Dimensions</dt><dd>${esc(dimensions)}</dd></div>
            <div><dt>Stored as</dt><dd>A link, not a file</dd></div>
          </dl>

          ${
            savedHere
              ? `<button class="detail-remove" type="button" data-action="detail-remove" data-url="${esc(
                  image.url
                )}">${icon("trash")} Remove from ${esc(board.name)}</button>`
              : ""
          }
        </div>
      </div>
      <section class="detail-related">
        <div class="detail-related-head">
          <h3>More like this</h3>
          <button class="icon-action" type="button" data-action="refresh-detail-related">${icon(
            "shuffle"
          )}Refresh</button>
        </div>
        <div id="detailRelatedBody">${detailRelatedHTML()}</div>
      </section>`;

    const dialog = $("#detailDialog");
    if (!dialog.open) dialog.showModal();
  }

  async function openDetail(image, boardId = "") {
    if (!image) return;
    remember(image);
    const token = ui.detail.token + 1;
    ui.detail = {
      image,
      boardId: boardId || "",
      related: [],
      loading: true,
      error: "",
      token,
    };
    renderDetail();
    await loadDetailRelated(token);
  }

  async function loadDetailRelated(token) {
    const image = ui.detail.image;
    if (!image || token !== ui.detail.token) return;

    const body = $("#detailRelatedBody");
    if (body) body.innerHTML = detailRelatedHTML();

    try {
      const items = await relatedImages(image);
      if (token !== ui.detail.token) return;
      ui.detail.related = items.filter((item) => item.url !== image.url).slice(0, 12);
      ui.detail.loading = false;
      ui.detail.error = "";
    } catch (error) {
      if (token !== ui.detail.token) return;
      ui.detail.loading = false;
      ui.detail.error = "Related images could not be reached right now.";
    }

    if (token === ui.detail.token) {
      const updated = $("#detailRelatedBody");
      if (updated) updated.innerHTML = detailRelatedHTML();
    }
  }

  function refreshDetailRelated() {
    if (!ui.detail.image) return;
    ui.detail.token += 1;
    ui.detail.related = [];
    ui.detail.loading = true;
    ui.detail.error = "";
    const body = $("#detailRelatedBody");
    if (body) body.innerHTML = detailRelatedHTML();
    loadDetailRelated(ui.detail.token);
  }

  /* ---------------------------------------------------------------------
     Save flow
     --------------------------------------------------------------------- */

  function renderSaveDialog() {
    const image = ui.saveImage;
    if (!image) return;
    const preview = $("#savePreview");
    const boards = $("#saveBoards");
    const src = safeUrl(image.thumb) || image.url;

    if (preview) {
      preview.innerHTML = `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer"${
        src !== image.url ? ` data-fallback="${esc(image.url)}"` : ""
      }><span class="save-preview-text"><strong>${esc(
        image.title || "Untitled image"
      )}</strong><span>${esc(sourceLabel(image))} · ${esc(image.license || "See source")}</span></span>`;
    }

    if (!boards) return;
    if (!state.boards.length) {
      boards.innerHTML = `<div class="related-empty" style="text-align:left">You do not have a board yet. Make one, and Sift will keep this link inside it.</div>`;
      return;
    }

    boards.innerHTML = state.boards
      .map((board) => {
        const contained = board.pins.some((pin) => pin.url === image.url);
        return `<button class="save-board${contained ? " is-contained" : ""}" type="button" data-action="save-to-board" data-board-id="${esc(
          board.id
        )}" data-url="${esc(image.url)}">
          <span class="board-swatch" style="--swatch:${swatchFor(board.id)}"></span>
          <span class="save-board-name">${esc(board.name)}</span>
          <span class="save-board-count">${board.pins.length}</span>
          ${contained ? icon("check") : ""}
        </button>`;
      })
      .join("");
  }

  function openSaveDialog(image, preferredBoardId = "") {
    if (!image) return;
    remember(image);
    ui.saveImage = image;
    ui.savePreferredBoard = preferredBoardId || "";
    renderSaveDialog();
    const dialog = $("#saveDialog");
    if (!dialog.open) dialog.showModal();
  }

  function afterSave(result, image) {
    if (!result.ok) {
      if (result.reason === "duplicate" && result.board) {
        showToast(`Already saved to “${result.board.name}”.`);
      }
      return;
    }

    syncSaveButtons(image.url);
    renderSidebar();

    if (ui.view.name === "board" && ui.view.boardId === result.board.id) {
      render();
    } else if (ui.view.name === "all") {
      render();
    }

    if ($("#detailDialog").open && ui.detail.image && ui.detail.image.url === image.url) {
      if (!ui.detail.boardId && ui.view.name === "board") ui.detail.boardId = result.board.id;
      renderDetail();
    }

    const boardId = result.board.id;
    const url = image.url;
    showToast(`Saved to “${result.board.name}”.`, {
      actionLabel: "Undo",
      duration: 7000,
      onAction: () => {
        const removed = removePinFromBoard(boardId, url);
        if (removed) {
          if (ui.view.name === "board" || ui.view.name === "all") render();
          if ($("#detailDialog").open) renderDetail();
          showToast("Removed from the board.");
        }
      },
    });
  }

  function quickSave(boardId, image) {
    const result = addPinToBoard(boardId, image, ui.view.name === "search" ? ui.view.query : "");
    afterSave(result, image);
  }

  /* ---------------------------------------------------------------------
     Board creation / editing / deletion
     --------------------------------------------------------------------- */

  function openBoardDialog(options = {}) {
    const mode = options.mode === "edit" ? "edit" : "create";
    const board = mode === "edit" ? boardById(options.boardId) : null;
    if (mode === "edit" && !board) return;

    ui.boardDialog = {
      mode,
      boardId: board ? board.id : "",
      pendingImage: options.pendingImage || null,
      stay: Boolean(options.stay),
      seed: cleanText(options.seed, 160),
    };

    const title = $("#boardDialogTitle");
    const eyebrow = $("#boardDialogEyebrow");
    const submit = $("#boardSubmit");
    const nameInput = $("#boardNameInput");
    const seedField = $("#boardSeedField");
    const seedInput = $("#boardSeedInput");

    if (title) title.textContent = mode === "edit" ? "Rename board" : "New board";
    if (eyebrow) eyebrow.textContent = mode === "edit" ? "A small correction" : "A new collection";
    if (submit) submit.textContent = mode === "edit" ? "Save name" : "Create board";
    if (nameInput) {
      nameInput.value = board ? board.name : options.name || (options.seed ? titleCase(options.seed) : "");
    }
    if (seedField) seedField.hidden = mode === "edit";
    if (seedInput) {
      seedInput.value = mode === "edit" ? "" : options.seed || "";
      seedInput.required = false;
    }

    const dialog = $("#boardDialog");
    if (!dialog.open) dialog.showModal();
    window.setTimeout(() => nameInput && nameInput.focus(), 60);
  }

  function submitBoardForm(event) {
    event.preventDefault();
    const nameInput = $("#boardNameInput");
    const seedInput = $("#boardSeedInput");
    const name = cleanText(nameInput ? nameInput.value : "", 80);
    if (!name) {
      nameInput?.focus();
      return;
    }

    if (ui.boardDialog.mode === "edit") {
      const board = boardById(ui.boardDialog.boardId);
      if (!board) return;
      board.name = name;
      board.updatedAt = nowIso();
      persist();
      renderSidebar();
      $("#boardDialog").close();
      render();
      showToast("Board renamed.");
      return;
    }

    const seed = seedInput ? cleanText(seedInput.value, 160) : ui.boardDialog.seed;
    const board = {
      id: uid(),
      name,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      seeds: [],
      pins: [],
    };
    if (seed) addSeed(board, seed);
    const pendingImage = ui.boardDialog.pendingImage;
    const stay = ui.boardDialog.stay;
    state.boards.unshift(board);
    persist();
    ui.dataVersion += 1;
    renderSidebar();
    $("#boardDialog").close();

    if (pendingImage) {
      const result = addPinToBoard(board.id, pendingImage, ui.view.name === "search" ? ui.view.query : "");
      go({ name: "board", boardId: board.id });
      afterSave(result, pendingImage);
    } else if (stay) {
      showToast(`Board “${board.name}” is ready. Save any image to it.`);
      if (ui.view.name === "search") render();
      else render();
    } else {
      go({ name: "board", boardId: board.id });
      showToast(`Board “${board.name}” created.`);
    }
  }

  function deleteCurrentBoard() {
    const board = boardById(ui.view.boardId);
    if (!board) return;
    const message = `Delete “${board.name}” and its ${board.pins.length} saved link${
      board.pins.length === 1 ? "" : "s"
    }? This only affects this browser.`;
    if (!window.confirm(message)) return;

    const index = state.boards.findIndex((item) => item.id === board.id);
    const removed = state.boards.splice(index, 1)[0];
    persist();
    ui.boardRelated = {
      boardId: "",
      loading: false,
      items: [],
      sig: "",
      error: "",
      notice: "",
      anchor: null,
      token: ui.boardRelated.token + 1,
    };
    renderSidebar();
    go({ name: "home" });
    showToast(`Deleted “${board.name}”.`, {
      actionLabel: "Undo",
      duration: 8000,
      onAction: () => {
        if (!boardById(removed.id)) {
          state.boards.splice(Math.min(index, state.boards.length), 0, removed);
          persist();
          renderSidebar();
          go({ name: "board", boardId: removed.id });
          showToast("Board restored.");
        }
      },
    });
  }

  /* ---------------------------------------------------------------------
     Manual links
     --------------------------------------------------------------------- */

  function openLinkDialog(boardId) {
    const board = boardById(boardId);
    if (!board) return;
    ui.linkBoardId = boardId;
    const urlInput = $("#linkUrlInput");
    const titleInput = $("#linkTitleInput");
    if (urlInput) urlInput.value = "";
    if (titleInput) titleInput.value = "";
    const dialog = $("#linkDialog");
    if (!dialog.open) dialog.showModal();
    window.setTimeout(() => urlInput && urlInput.focus(), 60);
  }

  function submitLinkForm(event) {
    event.preventDefault();
    const board = boardById(ui.linkBoardId);
    if (!board) return;
    const urlInput = $("#linkUrlInput");
    const titleInput = $("#linkTitleInput");
    const url = safeUrl(urlInput ? urlInput.value : "");
    if (!url) {
      showToast("That does not look like a valid http or https image link.");
      urlInput?.focus();
      return;
    }

    const title = cleanText(titleInput ? titleInput.value : "", 200);
    const image = {
      provider: "manual",
      openverseId: "",
      url,
      thumb: url,
      title: title || "Saved image link",
      creator: "Unknown",
      license: "See source",
      source: "Direct link",
      foreignLandingUrl: "",
      width: 0,
      height: 0,
      tags: titleWords(title, 6),
    };

    const result = addPinToBoard(board.id, image, title);
    if (!result.ok) {
      showToast(result.reason === "duplicate" ? "That link is already on this board." : "That link could not be added.");
      return;
    }

    $("#linkDialog").close();
    render();
    showToast(`Added to “${board.name}”.`);
  }

  /* ---------------------------------------------------------------------
     Export / import / erase
     --------------------------------------------------------------------- */

  function exportState() {
    const payload = {
      format: "sift.boards",
      version: VERSION,
      exportedAt: nowIso(),
      boards: state.boards,
      prefs: state.prefs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `sift-boards-${date}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Your boards were exported as JSON.");
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      if (text.length > 8 * 1024 * 1024) throw new Error("too large");
      const parsed = JSON.parse(text);
      const imported = sanitizeState(parsed);
      const pinCount = imported.boards.reduce((sum, board) => sum + board.pins.length, 0);
      const message = `Import ${imported.boards.length} board${
        imported.boards.length === 1 ? "" : "s"
      } and ${pinCount} link${pinCount === 1 ? "" : "s"}? This will replace the archive in this browser.`;
      if (!window.confirm(message)) return;

      state = imported;
      ui.dataVersion += 1;
      ui.feed = { loading: false, items: [], seeds: [], sig: "", error: "", notice: "", anchor: null };
      ui.boardRelated = {
        boardId: "",
        loading: false,
        items: [],
        sig: "",
        error: "",
        notice: "",
        anchor: null,
        token: 0,
      };
      searchCache.clear();
      relatedCache.clear();
      imageCache.clear();
      applyTheme();
      persist();
      renderSidebar();
      $("#settingsDialog")?.close();
      go({ name: "home" });
      showToast("Your archive was imported. It stays in this browser.");
    } catch (error) {
      showToast("That file could not be imported. Choose a Sift JSON export and try again.");
    }
  }

  /* ---------------------------------------------------------------------
     Pinterest import — a bookmarklet reads Pinterest, Sift previews it
     --------------------------------------------------------------------- */

  let pinterestTransfer = null;

  function normalizePinterestUsername(value) {
    let raw = String(value ?? "").trim();
    if (!raw) return "";
    const urlMatch = raw.match(/pinterest\.[a-z.]+\/([^/?#\s]+)/i);
    if (urlMatch) raw = urlMatch[1];
    raw = raw.replace(/^@+/, "").replace(/\/+$/, "").trim();
    return /^[a-z0-9_]{1,64}$/i.test(raw) ? raw : "";
  }

  function isPinterestOrigin(origin) {
    try {
      const host = new URL(origin).hostname.toLowerCase();
      return host === "pinterest.com" || host.endsWith(".pinterest.com");
    } catch {
      return false;
    }
  }

  function pinterestScraper(config) {
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const text = (value, max = 300) =>
        String(value ?? "")
          .replace(/[\u0000-\u001f\u007f]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, max);
      const imageUrl = (value) => {
        let raw = String(value ?? "").replace(/\\u002F/gi, "/");
        raw = raw.replace(/^\/\//, "https://").replace(/^http:\/\//i, "https://");
        return /^https:\/\/i\.pinimg\.com\//i.test(raw) ? raw : "";
      };
      const pinUrl = (id) => {
        const digits = String(id ?? "").replace(/\D/g, "");
        return digits ? `https://www.pinterest.com/pin/${digits}/` : "";
      };
      const boardPath = (board) => {
        const raw = String(board.url ?? "");
        if (/^https?:\/\//i.test(raw)) {
          try {
            return new URL(raw).pathname;
          } catch {
            return `/${config.username}/${board.id}/`;
          }
        }
        if (raw.startsWith("/")) return raw;
        return `/${config.username}/${board.id}/`;
      };
      const endpoint = (path, sourceUrl, options) => {
        const url = new URL(path, location.origin);
        url.searchParams.set("source_url", sourceUrl);
        url.searchParams.set("data", JSON.stringify({ options, context: {} }));
        url.searchParams.set("_", String(Date.now()));
        return url.href;
      };
      const fetchResource = async (path, sourceUrl, options) => {
        const response = await fetch(endpoint(path, sourceUrl, options), {
          credentials: "include",
          headers: {
            "X-Pinterest-PWS-Handler": "www/[username].js",
            Accept: "application/json",
          },
        });
        if (!response.ok) {
          throw new Error(`Pinterest returned ${response.status}.`);
        }
        const json = await response.json();
        if (json?.resource_response?.error) {
          throw new Error(text(json.resource_response.error, 180) || "Pinterest refused the request.");
        }
        return json?.resource_response || {};
      };
      const mapPin = (raw, board) => {
        if (!raw || typeof raw !== "object") return null;
        if (raw.type && raw.type !== "pin") return null;
        const images = raw.images && typeof raw.images === "object" ? raw.images : {};
        const pick = (...keys) => {
          for (const key of keys) {
            const image = images[key];
            if (!image || !image.url) continue;
            const url = imageUrl(image.url);
            if (url) {
              return {
                url,
                width: Number(image.width) || 0,
                height: Number(image.height) || 0,
              };
            }
          }
          return null;
        };
        let full = pick("orig", "originals", "736x", "564x", "474x", "236x");
        if (!full && raw.image) {
          const url = imageUrl(raw.image);
          if (url) full = { url, width: 0, height: 0 };
        }
        if (!full) return null;
        const thumb = pick("736x", "564x", "474x", "236x") || full;
        const pinner = raw.pinner && typeof raw.pinner === "object" ? raw.pinner : {};
        const creator = text(pinner.username, 60)
          ? `@${text(pinner.username, 60)}`
          : text(pinner.full_name, 100) || "Pinterest";
        const title =
          text(raw.title || raw.grid_title || raw.description || raw.alt_text, 240) ||
          `${text(board.name, 60) || "Pinterest"} pin`;
        return {
          url: full.url,
          thumb: thumb.url,
          title,
          creator,
          license: "Pinterest",
          source: "Pinterest",
          provider: "pinterest",
          foreignLandingUrl: pinUrl(raw.id),
          openverseId: "",
          width: full.width,
          height: full.height,
          tags: [],
          savedAt: new Date().toISOString(),
        };
      };

      const siftUrl =
        `${config.siftUrl}?pinterest-receive=${encodeURIComponent(config.token)}` +
        `&pinterest-user=${encodeURIComponent(config.username)}`;
      const popup = window.open(siftUrl, "_blank");
      if (!popup) {
        alert("Sift could not open a new tab. Allow pop-ups for Pinterest and try again.");
        return;
      }

      const siftOrigin = config.siftOrigin || "*";
      let ready = false;
      let done = null;
      let lastProgress = {
        phase: "start",
        text: "Reading the board list…",
        boards: 0,
        total: 0,
        pins: 0,
      };
      const post = (type, payload) => {
        if (!ready) return;
        try {
          popup.postMessage({ type, token: config.token, payload }, siftOrigin);
        } catch {
          /* the Sift tab may have moved on */
        }
      };
      const progress = (payload) => {
        lastProgress = payload;
        post("sift:pinterest-progress", payload);
      };
      const onReady = (event) => {
        if (event.origin !== siftOrigin) return;
        if (!event.data || event.data.type !== "sift:pinterest-ready") return;
        if (event.data.token !== config.token) return;
        ready = true;
        post("sift:pinterest-progress", lastProgress);
        if (done) {
          post("sift:pinterest-data", done);
          done = null;
          window.removeEventListener("message", onReady);
        }
      };
      window.addEventListener("message", onReady);

      try {
        for (let wait = 0; wait < 40 && !ready; wait += 1) {
          await sleep(250);
        }
        if (!ready) {
          throw new Error("Sift did not answer. Allow pop-ups for Pinterest, keep the Sift tab open, and run the importer again.");
        }
        const username = String(config.username || "").trim();
        const warnings = [];
        const incomplete = [];
        progress(lastProgress);
        const boardOptions = {
          page_size: 250,
          privacy_filter: "all",
          sort: "custom",
          username,
          isPrefetch: false,
          include_archived: true,
          field_set_key: "profile_grid_item",
          group_by: "visibility",
          redux_normalize_feed: true,
        };
        const seenBoards = new Set();
        const boards = [];
        const response = await fetchResource(
          "/resource/BoardsResource/get/",
          `/${username}/boards/`,
          boardOptions
        );
        const data = Array.isArray(response.data) ? response.data : [];
        for (const board of data) {
          if (!board || !board.id || board.type === "story") continue;
          const id = String(board.id);
          if (seenBoards.has(id)) continue;
          seenBoards.add(id);
          boards.push(board);
        }
        progress({
          phase: "boards",
          text: `Found ${boards.length} board${boards.length === 1 ? "" : "s"}…`,
          boards: boards.length,
          total: boards.length,
          pins: 0,
        });
        if (!boards.length) {
          throw new Error("No boards were returned. Check the username, and sign in to Pinterest for private boards.");
        }
        if (response.bookmark) warnings.push("Only the first 250 boards were read.");
        if (boards.length > (config.boardCap || 200)) warnings.push("Only the first 200 boards were imported.");

        const selectedBoards = boards.slice(0, config.boardCap || 200);
        const output = [];
        let pinTotal = 0;
        for (let index = 0; index < selectedBoards.length; index += 1) {
          const board = selectedBoards[index];
          const path = boardPath(board);
          const pins = [];
          let pinBookmark = "";
          let rawPinTotal = 0;
          let boardWarning = "";
          for (let page = 0; page < 40; page += 1) {
            if (pins.length >= (config.pinCap || 5000)) {
              boardWarning = `“${text(board.name, 80) || "Board"}” was capped at ${config.pinCap || 5000} links.`;
              break;
            }
            const options = { board_id: String(board.id), page_size: 250 };
            if (pinBookmark) options.bookmarks = [pinBookmark];
            let response;
            try {
              response = await fetchResource("/resource/BoardFeedResource/get/", path, options);
            } catch (error) {
              boardWarning = `Could not read “${text(board.name, 80) || "a board"}”: ${text(error.message, 120)}`;
              break;
            }
            const data = Array.isArray(response.data) ? response.data : [];
            rawPinTotal += data.length;
            for (const raw of data) {
              const pin = mapPin(raw, board);
              if (pin) pins.push(pin);
              if (pins.length >= (config.pinCap || 5000)) break;
            }
            const next = String(response.bookmark || "");
            if (!next || next === pinBookmark || !data.length) break;
            pinBookmark = next;
            await sleep(110);
          }
          const expectedPins = Number(board.pin_count) || 0;
          if (!boardWarning && expectedPins && rawPinTotal < expectedPins && !pinBookmark) {
            incomplete.push({
              name: text(board.name, 80) || "a board",
              got: rawPinTotal,
              total: expectedPins
            });
          }
          if (boardWarning) warnings.push(boardWarning);
          pinTotal += pins.length;
          output.push({
            id: String(board.id),
            name: text(board.name, 80) || "Untitled board",
            privacy: ["public", "private", "secret"].includes(String(board.privacy))
              ? String(board.privacy)
              : "public",
            pins,
          });
          progress({
            phase: "pins",
            text: `Read ${pinTotal} link${pinTotal === 1 ? "" : "s"} from ${index + 1} of ${
              selectedBoards.length
            } boards…`,
            boards: index + 1,
            total: selectedBoards.length,
            pins: pinTotal,
          });
          await sleep(140);
        }

        if (incomplete.length) {
          const sample = incomplete
            .slice(0, 3)
            .map(item => `“${item.name}” (${item.got}/${item.total})`)
            .join(", ");
          warnings.push(
            `Pinterest limited ${incomplete.length} board${incomplete.length === 1 ? "" : "s"}: ${sample}${
              incomplete.length > 3 ? ` and ${incomplete.length - 3} more` : ""
            }. Sign in to Pinterest for fuller imports.`
          );
        }
        done = { username, boards: output, warnings: warnings.slice(0, 40) };
        for (let wait = 0; wait < 20 && !ready; wait += 1) {
          await sleep(500);
        }
        if (!ready) {
          throw new Error("Sift did not answer. Close the extra tab, allow pop-ups for Pinterest, and run the importer again.");
        }
        post("sift:pinterest-data", done);
        done = null;
        window.removeEventListener("message", onReady);
      } catch (error) {
        post("sift:pinterest-error", { message: text(error.message, 240) || "Pinterest import failed." });
        window.removeEventListener("message", onReady);
        alert(text(error.message, 300) || "Pinterest import failed.");
      }
    })();
  }

  function pinterestBookmarkletCode(username) {
    const config = {
      username,
      token: uid(),
      siftUrl: location.origin + location.pathname,
      siftOrigin: location.origin,
      boardCap: MAX_BOARDS,
      pinCap: PINTEREST_PIN_CAP,
    };
    return `javascript:(${pinterestScraper.toString()})(${JSON.stringify(config)});void 0`;
  }

  function updatePinterestBookmarklet() {
    const input = $("#pinterestUsername");
    const hint = $("#pinterestUsernameHint");
    const link = $("#pinterestBookmarklet");
    if (!input || !link) return;
    const raw = input.value;
    const username = normalizePinterestUsername(raw);
    const secure = /^https?:$/.test(location.protocol);

    if (!secure) {
      link.removeAttribute("href");
      link.dataset.bookmarklet = "";
      link.setAttribute("aria-disabled", "true");
      if (hint) hint.textContent = "The importer needs Sift served over http or https.";
      return;
    }

    if (!username) {
      link.removeAttribute("href");
      link.dataset.bookmarklet = "";
      link.setAttribute("aria-disabled", "true");
      input.removeAttribute("aria-invalid");
      if (hint) {
        hint.textContent = raw.trim()
          ? "Use letters, numbers, and underscores only."
          : "Use the name in pinterest.com/name/.";
      }
      return;
    }

    const code = pinterestBookmarkletCode(username);
    link.href = code;
    link.dataset.bookmarklet = code;
    link.removeAttribute("aria-disabled");
    link.title = `Drag this to your bookmarks bar to import @${username}`;
    input.removeAttribute("aria-invalid");
    if (hint) hint.textContent = `Ready for @${username}. Drag the button, or use Copy.`;
  }

  function openPinterestDialog() {
    const dialog = $("#pinterestDialog");
    if (!dialog) return;
    $("#settingsDialog")?.close();
    updatePinterestBookmarklet();
    if (!dialog.open) dialog.showModal();
    window.setTimeout(() => $("#pinterestUsername")?.focus(), 60);
  }

  async function copyPinterestBookmarklet() {
    const code = $("#pinterestBookmarklet")?.dataset.bookmarklet || "";
    if (!code) {
      showToast("Enter a valid Pinterest username first.");
      $("#pinterestUsername")?.focus();
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      showToast("Bookmarklet copied. Make a bookmark and paste it as the URL.");
    } catch {
      showToast("Copy was blocked. Drag the button to your bookmarks bar instead.");
    }
  }

  function openPinterestProfile() {
    const username = normalizePinterestUsername($("#pinterestUsername")?.value || "");
    if (!username) {
      showToast("Enter a Pinterest username first.");
      $("#pinterestUsername")?.focus();
      return;
    }
    window.open(`https://www.pinterest.com/${encodeURIComponent(username)}/`, "_blank", "noopener");
  }

  function sanitizePinterestPayload(raw, fallbackUsername = "") {
    const source = raw && typeof raw === "object" ? raw : {};
    const username = normalizePinterestUsername(source.username) || fallbackUsername;
    const boards = [];
    const rawBoards = Array.isArray(source.boards) ? source.boards.slice(0, MAX_BOARDS) : [];
    for (const rawBoard of rawBoards) {
      if (!rawBoard || typeof rawBoard !== "object") continue;
      const name = cleanText(rawBoard.name, 80) || "Untitled board";
      const id = cleanText(rawBoard.id, 80) || name.toLowerCase();
      const privacy = ["public", "private", "secret"].includes(rawBoard.privacy)
        ? rawBoard.privacy
        : "public";
      const pins = [];
      const seenPins = new Set();
      const rawPins = Array.isArray(rawBoard.pins) ? rawBoard.pins.slice(0, MAX_PINS_PER_BOARD) : [];
      for (const rawPin of rawPins) {
        const pin = sanitizePin({
          ...rawPin,
          provider: "pinterest",
          source: "Pinterest",
          license: "Pinterest",
        });
        if (!pin || seenPins.has(pin.url)) continue;
        seenPins.add(pin.url);
        pins.push(pin);
      }
      boards.push({ id, name, privacy, pins });
    }
    const warnings = Array.isArray(source.warnings)
      ? source.warnings.map((warning) => cleanText(warning, 180)).filter(Boolean).slice(0, 12)
      : [];
    return { username, boards, warnings };
  }

  function pinterestProgress(payload = {}) {
    const fill = $("#pinterestProgressFill");
    const label = $("#pinterestProgressText");
    const total = Number(payload.total) || 0;
    const boards = Number(payload.boards) || 0;
    let percent = 8;
    if (payload.phase === "boards" && total) percent = 10 + Math.round((boards / total) * 55);
    else if (payload.phase === "pins" && total) percent = 66 + Math.round((boards / total) * 30);
    else if (payload.phase === "start") percent = 8;
    if (fill) fill.style.width = `${Math.max(3, Math.min(98, percent))}%`;
    if (label) {
      const pins = Number(payload.pins) || 0;
      label.textContent =
        cleanText(payload.text, 180) ||
        `${boards} board${boards === 1 ? "" : "s"} · ${pins} link${pins === 1 ? "" : "s"}`;
    }
  }

  function pinterestWaiting(message = "Waiting for the Pinterest tab to send boards…") {
    const body = $("#pinterestReceiveBody");
    if (!body) return;
    body.innerHTML = `
      <div class="pinterest-waiting">
        <p>${esc(message)}</p>
        <div class="pinterest-progress" role="status" aria-live="polite">
          <div class="pinterest-progress-track"><div class="pinterest-progress-fill" id="pinterestProgressFill"></div></div>
          <p class="pinterest-progress-text" id="pinterestProgressText">Starting…</p>
        </div>
        <p class="field-hint">Keep this tab open. Nothing is saved until you approve the preview.</p>
      </div>`;
    pinterestProgress({ phase: "start", text: "Starting…" });
  }

  function pinterestPreview(data) {
    const body = $("#pinterestReceiveBody");
    if (!body) return;
    if (!data.boards.length) {
      body.innerHTML = `
        <div class="pinterest-empty">Pinterest returned no boards for this account. Check the username, or sign in to Pinterest for private boards.</div>
        <div class="dialog-actions"><button class="btn btn-quiet" type="button" data-close>Close</button></div>`;
      return;
    }

    const pins = data.boards.reduce((sum, board) => sum + board.pins.length, 0);
    const privateCount = data.boards.filter((board) => board.privacy !== "public").length;
    const warning = data.warnings.length
      ? `<p class="pinterest-warning">${esc(data.warnings.slice(0, 3).join(" "))}${
          data.warnings.length > 3 ? " …" : ""
        }</p>`
      : "";
    body.innerHTML = `
      <p class="pinterest-lede">Pinterest handed over <strong>${data.boards.length}</strong> board${
        data.boards.length === 1 ? "" : "s"
      } and <strong>${pins}</strong> link${pins === 1 ? "" : "s"}${
        privateCount ? `, including ${privateCount} private board${privateCount === 1 ? "" : "s"}` : ""
      }.</p>
      <div class="pinterest-summary">
        <span>@${esc(data.username || "pinterest")}</span>
        <span>${data.boards.length} boards</span>
        <span>${pins} links</span>
      </div>
      ${warning}
      <label class="pinterest-select-all">
        <input id="pinterestSelectAll" type="checkbox" checked>
        Select all <span id="pinterestSelectionCount"></span>
      </label>
      <div class="pinterest-board-list" id="pinterest-board-list">
        ${data.boards
          .map(
            (board, index) => `
          <label class="pinterest-board-row">
            <input type="checkbox" data-pinterest-board="${index}" checked>
            <span class="pinterest-board-name">${esc(board.name)}</span>
            <span class="pinterest-board-meta">${board.pins.length} link${
              board.pins.length === 1 ? "" : "s"
            }${board.privacy !== "public" ? " · private" : ""}</span>
          </label>`
          )
          .join("")}
      </div>
      <p class="field-hint">Boards with the same name are merged. Links already in a board are skipped.</p>
      <p class="pinterest-error" id="pinterestImportError" hidden></p>
      <div class="dialog-actions">
        <button class="btn btn-quiet" type="button" data-close>Cancel</button>
        <button class="btn btn-primary" type="button" data-action="pinterest-import">${icon(
          "download"
        )}Import selected</button>
      </div>`;
    updatePinterestSelection();
  }

  function updatePinterestSelection() {
    const boxes = $$("[data-pinterest-board]");
    const selected = boxes.filter((box) => box.checked);
    const all = $("#pinterestSelectAll");
    const count = $("#pinterestSelectionCount");
    if (all) {
      all.checked = boxes.length > 0 && selected.length === boxes.length;
      all.indeterminate = selected.length > 0 && selected.length < boxes.length;
    }
    if (count) count.textContent = `(${selected.length} selected)`;
  }

  function setPinterestError(message) {
    const error = $("#pinterestImportError");
    if (!error) return;
    error.textContent = message;
    error.hidden = !message;
  }

  function mergePinterestBoards(username, boards) {
    const next = JSON.parse(JSON.stringify(state));
    let created = 0;
    let merged = 0;
    let added = 0;
    let duplicates = 0;
    let skipped = 0;
    let skippedBoards = 0;

    for (const imported of boards) {
      let board = next.boards.find(
        (candidate) =>
          candidate.origin &&
          candidate.origin.provider === "pinterest" &&
          String(candidate.origin.boardId) === String(imported.id)
      );
      if (!board) {
        board = next.boards.find(
          (candidate) => candidate.name.toLowerCase() === imported.name.toLowerCase()
        );
      }
      if (!board) {
        if (next.boards.length >= MAX_BOARDS) {
          skippedBoards += 1;
          continue;
        }
        board = {
          id: uid(),
          name: imported.name,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          seeds: [],
          origin: { provider: "pinterest", boardId: imported.id, username },
          pins: [],
        };
        next.boards.push(board);
        created += 1;
      } else {
        merged += 1;
        if (!board.origin) {
          board.origin = { provider: "pinterest", boardId: imported.id, username };
        }
      }

      const seenPins = new Set(board.pins.map((pin) => pin.url));
      for (const pin of imported.pins) {
        if (seenPins.has(pin.url)) {
          duplicates += 1;
          continue;
        }
        if (board.pins.length >= MAX_PINS_PER_BOARD) {
          skipped += 1;
          continue;
        }
        board.pins.push(pin);
        seenPins.add(pin.url);
        added += 1;
      }
      addSeed(board, imported.name);
      board.updatedAt = nowIso();
    }

    if (!persist(next, { quiet: true })) {
      return { ok: false, reason: "storage" };
    }

    state = next;
    ui.dataVersion += 1;
    ui.feed.sig = "";
    ui.feed.error = "";
    renderSidebar();

    return { ok: true, created, merged, added, duplicates, skipped, skippedBoards };
  }

  function importSelectedPinterest() {
    if (!pinterestTransfer || !pinterestTransfer.data) return;
    const data = pinterestTransfer.data;
    const selected = $$("[data-pinterest-board]")
      .filter((box) => box.checked)
      .map((box) => data.boards[Number(box.dataset.pinterestBoard)])
      .filter(Boolean);
    if (!selected.length) {
      setPinterestError("Choose at least one board to import.");
      return;
    }

    const result = mergePinterestBoards(data.username, selected);
    if (!result.ok) {
      setPinterestError(
        "This browser ran out of space for the import. Nothing was changed. Select fewer boards and try again."
      );
      return;
    }

    $("#pinterestReceiveDialog")?.close();
    go({ name: "home" });
    const bits = [];
    if (result.added) bits.push(`${result.added} link${result.added === 1 ? "" : "s"}`);
    if (result.created) bits.push(`${result.created} new board${result.created === 1 ? "" : "s"}`);
    if (!result.added && !result.created) {
      showToast("Those Pinterest boards are already up to date.");
      return;
    }
    let message = `Imported ${bits.join(" and ")} from @${data.username || "Pinterest"}.`;
    if (result.skipped) message += ` ${result.skipped} links hit the board limit.`;
    if (result.skippedBoards) message += ` ${result.skippedBoards} boards hit the board limit.`;
    showToast(message, { duration: 8000 });
  }

  function initPinterestReceiver() {
    const params = new URLSearchParams(location.search);
    const token = cleanText(params.get("pinterest-receive"), 80);
    if (!token) return false;
    const fallbackUsername = normalizePinterestUsername(params.get("pinterest-user"));
    try {
      history.replaceState(null, "", location.pathname + location.hash);
    } catch {
      /* ignore */
    }

    const dialog = $("#pinterestReceiveDialog");
    if (!dialog) return false;
    pinterestTransfer = {
      token,
      username: fallbackUsername,
      data: null,
      readyTimer: 0,
      handler: null,
    };
    if (!dialog.open) dialog.showModal();
    pinterestWaiting(
      window.opener
        ? "Waiting for the Pinterest tab to send boards…"
        : "This window needs to be opened by the Pinterest bookmarklet. Close it and run the importer from Pinterest."
    );

    const announce = () => {
      if (!window.opener) return;
      try {
        window.opener.postMessage({ type: "sift:pinterest-ready", token }, "*");
      } catch {
        /* ignore */
      }
    };
    announce();
    pinterestTransfer.readyTimer = window.setInterval(announce, 1400);

    const handler = (event) => {
      if (!isPinterestOrigin(event.origin)) return;
      if (!event.data || event.data.type?.startsWith("sift:pinterest-") !== true) return;
      if (event.data.token !== token) return;

      if (event.data.type === "sift:pinterest-progress") {
        pinterestProgress(event.data.payload || {});
        return;
      }
      if (event.data.type === "sift:pinterest-error") {
        const message = cleanText(event.data.payload?.message, 220) || "Pinterest import failed.";
        const body = $("#pinterestReceiveBody");
        if (body) {
          body.innerHTML = `
            <p class="pinterest-error">${esc(message)}</p>
            <div class="pinterest-empty">Check that the username is correct and that you are signed in to Pinterest if you expected private boards. Close this window, then run the bookmarklet again.</div>
            <div class="dialog-actions"><button class="btn btn-quiet" type="button" data-close>Close</button></div>`;
        }
        window.clearInterval(pinterestTransfer.readyTimer);
        return;
      }
      if (event.data.type === "sift:pinterest-data") {
        const data = sanitizePinterestPayload(event.data.payload, fallbackUsername);
        pinterestTransfer.data = data;
        window.clearInterval(pinterestTransfer.readyTimer);
        pinterestPreview(data);
      }
    };
    pinterestTransfer.handler = handler;
    window.addEventListener("message", handler);

    dialog.addEventListener(
      "close",
      () => {
        window.clearInterval(pinterestTransfer?.readyTimer || 0);
        if (pinterestTransfer?.handler) {
          window.removeEventListener("message", pinterestTransfer.handler);
        }
        pinterestTransfer = null;
      },
      { once: true }
    );
    return true;
  }

  function eraseEverything() {
    const pins = allPins().length;
    if (!pins && !state.boards.length) {
      showToast("There is nothing to erase.");
      return;
    }
    if (
      !window.confirm(
        `Erase all ${state.boards.length} boards and ${pins} links from this browser? This cannot be undone unless you have an export.`
      )
    ) {
      return;
    }

    const theme = state.prefs.theme;
    state = defaultState();
    state.prefs.theme = theme;
    $("#settingsDialog")?.close();
    $("#privacyDialog")?.close();
    $("#detailDialog")?.close();
    $("#saveDialog")?.close();
    $("#pinterestDialog")?.close();
    $("#pinterestReceiveDialog")?.close();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    persist();
    ui.dataVersion += 1;
    ui.feed = { loading: false, items: [], seeds: [], sig: "", error: "", notice: "", anchor: null };
    searchCache.clear();
    relatedCache.clear();
    imageCache.clear();
    renderSidebar();
    go({ name: "home" });
    showToast("Everything was erased from this browser.");
  }

  /* ---------------------------------------------------------------------
     Toast
     --------------------------------------------------------------------- */

  function showToast(message, options = {}) {
    const toast = $("#toast");
    const text = $("#toastMessage");
    const action = $("#toastAction");
    if (!toast || !text || !action) return;

    window.clearTimeout(ui.toastTimer);
    text.textContent = message;
    ui.toastAction = typeof options.onAction === "function" ? options.onAction : null;

    if (ui.toastAction && options.actionLabel) {
      action.hidden = false;
      action.textContent = options.actionLabel;
    } else {
      action.hidden = true;
      action.textContent = "";
    }

    toast.hidden = false;
    const duration = options.duration || 4600;
    ui.toastTimer = window.setTimeout(() => {
      toast.hidden = true;
      ui.toastAction = null;
    }, duration);
  }

  /* ---------------------------------------------------------------------
     Navigation + rendering
     --------------------------------------------------------------------- */

  function go(view, options = {}) {
    ui.view = view;
    closeMobileNav();
    if (!options.keepScroll) window.scrollTo({ top: 0, behavior: "auto" });
    render();
    if (!options.noFocus) {
      const main = $("#view");
      if (main) main.focus({ preventScroll: true });
    }
  }

  function render() {
    updateSidebarState();

    if (ui.view.name === "search") renderSearch();
    else if (ui.view.name === "all") renderAllSaved();
    else if (ui.view.name === "board") renderBoard();
    else renderHome();

    updateSidebarState();
    observeReveals();

    if (ui.view.name === "home" && allPins().length) {
      const signature = feedSignature();
      const needsFeed = ui.feed.sig !== signature && !ui.feed.error;
      if (needsFeed && !ui.feed.loading) {
        window.requestAnimationFrame(() => loadHomeFeed());
      }
    }

    if (ui.view.name === "board") {
      const board = boardById(ui.view.boardId);
      if (board && ui.boardRelated.boardId !== board.id) {
        const token = ui.boardRelated.token + 1;
        ui.boardRelated = {
          boardId: board.id,
          loading: false,
          items: [],
          sig: "",
          error: "",
          notice: "",
          anchor: null,
          token,
        };
      }
      const signature = board ? boardRelatedSignature(board) : "";
      const needsRelated =
        board &&
        (board.pins.length || board.seeds.length) &&
        ui.boardRelated.sig !== signature &&
        !ui.boardRelated.error;
      if (needsRelated && !ui.boardRelated.loading) {
        window.requestAnimationFrame(() => loadBoardRelated());
      }
    }
  }

  function observeReveals() {
    const elements = $$(".reveal:not(.is-in)");
    if (!elements.length) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      elements.forEach((element) => element.classList.add("is-in"));
      return;
    }

    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("is-in"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px 10% 0px", threshold: 0.05 }
    );

    elements.forEach((element) => observer.observe(element));
  }

  function syncSaveButtons(url) {
    for (const button of $$('[data-action="save"]')) {
      if (button.dataset.url !== url) continue;
      const boardId = button.dataset.boardId || "";
      const saved = boardId ? isSavedIn(boardId, url) : isSavedAnywhere(url);
      button.classList.toggle("is-saved", saved);
      button.innerHTML = `${icon(saved ? "check" : "bookmark")}<span>${saved ? "Saved" : "Save"}</span>`;
      button.setAttribute("aria-label", saved ? "Saved image" : "Save image");
    }
  }

  /* ---------------------------------------------------------------------
     Actions
     --------------------------------------------------------------------- */

  function closeBoardMenu() {
    $$(".menu-popover").forEach((menu) => {
      menu.hidden = true;
    });
    $$('[data-action="board-menu"]').forEach((button) => button.setAttribute("aria-expanded", "false"));
  }

  function handleAction(element, event) {
    const action = element.dataset.action;
    if (!action) return false;

    switch (action) {
      case "export":
        exportState();
        return true;
      case "import":
        $("#importFile")?.click();
        return true;
      case "privacy":
        $("#privacyDialog")?.showModal();
        return true;
      case "pinterest":
        openPinterestDialog();
        return true;
      case "pinterest-copy":
        copyPinterestBookmarklet();
        return true;
      case "pinterest-open":
        openPinterestProfile();
        return true;
      case "pinterest-import":
        importSelectedPinterest();
        return true;
      case "erase":
        eraseEverything();
        return true;
      case "start-board": {
        const query = element.dataset.query || ui.search.query || ui.lastQuery;
        openBoardDialog({ seed: query, name: query ? titleCase(query) : "", stay: true });
        return true;
      }
      case "open-pin": {
        const image = resolveImage(element.dataset.url);
        if (image) openDetail(image, element.dataset.boardId || "");
        return true;
      }
      case "save": {
        const image = resolveImage(element.dataset.url);
        if (!image) return true;
        const boardId = element.dataset.boardId || "";
        if (boardId) quickSave(boardId, image);
        else openSaveDialog(image);
        return true;
      }
      case "save-to-board": {
        const boardId = element.dataset.boardId || "";
        const image = ui.saveImage;
        if (!image) return true;
        const result = addPinToBoard(boardId, image, ui.view.name === "search" ? ui.view.query : "");
        $("#saveDialog")?.close();
        afterSave(result, image);
        return true;
      }
      case "retry-feed":
        ui.feed.items = [];
        ui.feed.sig = "";
        ui.feed.error = "";
        loadHomeFeed(true);
        return true;
      case "refresh-feed":
        refreshFeed();
        return true;
      case "load-more":
        performSearch(ui.search.query, { append: true });
        return true;
      case "retry-search":
        performSearch(ui.search.query);
        return true;
      case "add-link":
        openLinkDialog(element.dataset.boardId || ui.view.boardId);
        return true;
      case "rename-board":
        closeBoardMenu();
        openBoardDialog({ mode: "edit", boardId: ui.view.boardId });
        return true;
      case "delete-board":
        closeBoardMenu();
        deleteCurrentBoard();
        return true;
      case "board-menu": {
        const menu = element.nextElementSibling;
        if (!menu) return true;
        const wasOpen = !menu.hidden;
        closeBoardMenu();
        if (!wasOpen) {
          menu.hidden = false;
          element.setAttribute("aria-expanded", "true");
        }
        return true;
      }
      case "find-related": {
        closeBoardMenu();
        loadBoardRelated(true).finally(() => {
          const section = $("#board-related");
          if (section) {
            section.scrollIntoView({
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
              block: "start",
            });
          }
        });
        return true;
      }
      case "retry-board-related":
        ui.boardRelated.error = "";
        loadBoardRelated(true);
        return true;
      case "refresh-board-related":
        ui.boardRelated.items = [];
        loadBoardRelated(true);
        return true;
      case "detail-save": {
        const image = ui.detail.image || resolveImage(element.dataset.url);
        if (!image) return true;
        const boardId = ui.detail.boardId;
        if (boardId && !isSavedIn(boardId, image.url)) quickSave(boardId, image);
        else openSaveDialog(image, boardId);
        return true;
      }
      case "detail-remove": {
        const boardId = ui.detail.boardId;
        const image = ui.detail.image;
        if (!boardId || !image) return true;
        const removed = removePinFromBoard(boardId, image.url);
        $("#detailDialog")?.close();
        if (removed) {
          if (ui.view.name === "board" || ui.view.name === "all") render();
          showToast(`Removed from “${removed.board.name}”.`, {
            actionLabel: "Undo",
            duration: 7000,
            onAction: () => {
              const board = boardById(removed.board.id);
              if (board && !board.pins.some((pin) => pin.url === removed.pin.url)) {
                board.pins.splice(Math.min(removed.index, board.pins.length), 0, removed.pin);
                board.updatedAt = nowIso();
                persist();
                renderSidebar();
                if (ui.view.name === "board" || ui.view.name === "all") render();
                showToast("Put back on the board.");
              }
            },
          });
        }
        return true;
      }
      case "open-related": {
        const image = resolveImage(element.dataset.url);
        if (image) openDetail(image, ui.detail.boardId);
        return true;
      }
      case "refresh-detail-related":
        refreshDetailRelated();
        return true;
      case "focus-search": {
        const input = $("#searchInput");
        if (input) {
          input.focus();
          input.select();
        }
        return true;
      }
      default:
        return false;
    }
  }

  function resetBoardDialog() {
    ui.boardDialog = {
      mode: "create",
      boardId: "",
      pendingImage: null,
      stay: false,
      seed: "",
    };
  }

  function resetSaveDialog() {
    ui.saveImage = null;
    ui.savePreferredBoard = "";
  }

  /* ---------------------------------------------------------------------
     Settings summary
     --------------------------------------------------------------------- */

  function updateSettingsSummary() {
    const summary = $("#storageSummary");
    if (!summary) return;
    const pins = allPins().length;
    if (!storageAvailable) {
      summary.textContent =
        "Storage is blocked in this browser. Changes will work for this tab only and disappear when you leave.";
      return;
    }
    let bytes = 0;
    try {
      bytes = new Blob([JSON.stringify(state)]).size;
    } catch {
      bytes = JSON.stringify(state).length;
    }
    summary.textContent = `${state.boards.length} board${
      state.boards.length === 1 ? "" : "s"
    } · ${pins} image link${pins === 1 ? "" : "s"} · about ${formatBytes(bytes)} stored locally.`;
  }

  /* ---------------------------------------------------------------------
     Events
     --------------------------------------------------------------------- */

  function handleDocumentClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.id === "scrim") {
      closeMobileNav();
      return;
    }

    const closeButton = target.closest("[data-close]");
    if (closeButton) {
      const dialog = closeButton.closest("dialog");
      if (dialog) dialog.close();
      return;
    }

    const nav = target.closest("[data-nav]");
    if (nav) {
      event.preventDefault();
      closeBoardMenu();
      if (nav.dataset.nav === "board") {
        const boardId = nav.dataset.boardId;
        if (boardById(boardId)) go({ name: "board", boardId });
      } else if (nav.dataset.nav === "all") {
        go({ name: "all" });
      } else {
        go({ name: "home" });
      }
      return;
    }

    const search = target.closest("[data-search]");
    if (search) {
      event.preventDefault();
      closeBoardMenu();
      performSearch(search.dataset.search);
      return;
    }

    const action = target.closest("[data-action]");
    if (action) {
      if (action.disabled) return;
      const handled = handleAction(action, event);
      if (handled && !target.closest(".board-menu-wrap")) closeBoardMenu();
      return;
    }

    if (!target.closest(".board-menu-wrap")) closeBoardMenu();
  }

  function bindEvents() {
    document.addEventListener("click", handleDocumentClick);

    document.addEventListener(
      "error",
      (event) => {
        const img = event.target;
        if (!(img instanceof HTMLImageElement)) return;
        const fallback = img.dataset.fallback;
        if (fallback && img.src !== fallback) {
          delete img.dataset.fallback;
          img.src = fallback;
          return;
        }
        const holder = img.closest(".pin-media, .detail-media, .related-card, .save-preview");
        img.remove();
        if (holder) {
          holder.classList.add("is-fallback");
          const note = document.createElement("span");
          note.className = "image-fallback-note";
          note.textContent = "Image unavailable";
          holder.appendChild(note);
        }
      },
      true
    );

    document.addEventListener("submit", (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;

      if (form.id === "searchForm" || form.matches("[data-search-form]")) {
        event.preventDefault();
        const data = new FormData(form);
        const query = cleanText(data.get("q"), 180);
        if (query) performSearch(query);
        return;
      }

      if (form.id === "boardForm") {
        submitBoardForm(event);
        return;
      }

      if (form.id === "linkForm") {
        submitLinkForm(event);
        return;
      }
    });

    $("#menuBtn")?.addEventListener("click", () => {
      if (document.body.classList.contains("nav-open")) closeMobileNav();
      else openMobileNav();
    });
    $("#sidebarClose")?.addEventListener("click", closeMobileNav);

    $("#themeBtn")?.addEventListener("click", () => {
      chooseTheme(resolvedTheme() === "dusk" ? "light" : "dusk");
    });

    $("#themeSegmented")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-theme-choice]");
      if (button) chooseTheme(button.dataset.themeChoice);
    });

    $("#settingsBtn")?.addEventListener("click", () => {
      updateSettingsSummary();
      applyTheme();
      const dialog = $("#settingsDialog");
      if (dialog && !dialog.open) dialog.showModal();
    });

    $("#privacyBtn")?.addEventListener("click", () => {
      const dialog = $("#privacyDialog");
      if (dialog && !dialog.open) dialog.showModal();
    });

    const openNewBoard = () => {
      closeMobileNav();
      openBoardDialog({
        seed: ui.view.name === "search" ? ui.view.query : "",
        stay: ui.view.name === "search",
      });
    };
    $("#newBoardBtn")?.addEventListener("click", openNewBoard);
    $("#newBoardLink")?.addEventListener("click", openNewBoard);

    $("#saveNewBoard")?.addEventListener("click", () => {
      const image = ui.saveImage;
      if (!image) return;
      const query = ui.view.name === "search" ? ui.view.query : ui.lastQuery;
      $("#saveDialog")?.close();
      openBoardDialog({
        pendingImage: image,
        seed: query || "",
        name: query ? titleCase(query) : cleanText(image.title, 48),
      });
    });

    $("#toastAction")?.addEventListener("click", () => {
      const action = ui.toastAction;
      const toast = $("#toast");
      ui.toastAction = null;
      window.clearTimeout(ui.toastTimer);
      if (toast) toast.hidden = true;
      if (typeof action === "function") action();
    });

    $("#importFile")?.addEventListener("change", (event) => {
      const input = event.target;
      const file = input.files && input.files[0];
      input.value = "";
      if (file) importFile(file);
    });

    $("#pinterestUsername")?.addEventListener("input", updatePinterestBookmarklet);
    $("#pinterestBookmarklet")?.addEventListener("click", (event) => {
      event.preventDefault();
      copyPinterestBookmarklet();
    });

    document.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.id === "pinterestSelectAll") {
        $$("[data-pinterest-board]").forEach((box) => {
          box.checked = target.checked;
        });
        updatePinterestSelection();
      } else if (target.matches("[data-pinterest-board]")) {
        updatePinterestSelection();
      }
    });

    themeMedia.addEventListener("change", () => {
      if (state.prefs.theme === "auto") applyTheme();
    });

    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY) return;
      state = loadState();
      applyTheme();
      renderSidebar();
      render();
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 980 && document.body.classList.contains("nav-open")) {
        closeMobileNav();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeMobileNav();
        closeBoardMenu();
      }

      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.target.closest("input, textarea, select, [contenteditable='true']")
      ) {
        event.preventDefault();
        $("#searchInput")?.focus();
      }
    });

    $$("dialog").forEach((dialog) => {
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });

      dialog.addEventListener("close", () => {
        if (dialog.id === "saveDialog") resetSaveDialog();
        if (dialog.id === "boardDialog") resetBoardDialog();
        if (dialog.id === "detailDialog") ui.detail.token += 1;
      });
    });

    if (window.innerWidth > 980) closeMobileNav();
  }

  /* ---------------------------------------------------------------------
     Init
     --------------------------------------------------------------------- */

  function init() {
    applyTheme();
    bindEvents();
    renderSidebar();
    render();

    if (bootNotice) {
      window.setTimeout(() => showToast(bootNotice, { duration: 8000 }), 350);
    }

    initPinterestReceiver();
  }

  init();
})();