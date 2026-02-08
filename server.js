#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const ROOT_DIR = process.cwd();
const PORT = Number(process.env.PORT || 3000);
const UPLOAD_DIR = path.join(ROOT_DIR, "img", "uploads");
const MAX_BODY_BYTES = 25 * 1024 * 1024; // 25MB
const DATA_DIR = path.join(ROOT_DIR, "data");
const CUSTOM_ITEMS_PATH = path.join(DATA_DIR, "custom-items.json");
const DELETED_IDS_PATH = path.join(DATA_DIR, "deleted-ids.json");
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "admin");
const SESSION_COOKIE = "kcm_session";
const sessions = new Set();

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function parseCookies(headerValue) {
  const result = {};
  const header = String(headerValue || "");
  if (!header) return result;
  header.split(";").forEach((part) => {
    const [k, ...rest] = part.trim().split("=");
    if (!k) return;
    result[k] = decodeURIComponent(rest.join("=") || "");
  });
  return result;
}

function isLoggedIn(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  return Boolean(token && sessions.has(token));
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

function safeResolveUrlPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const cleaned = decoded.replaceAll("\\", "/");
  const stripped = cleaned.startsWith("/") ? cleaned.slice(1) : cleaned;
  const resolved = path.resolve(ROOT_DIR, stripped);
  if (!resolved.startsWith(ROOT_DIR)) return null;
  return resolved;
}

async function readRequestBody(req) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    if (String(error?.message) === "body_too_large") {
      sendJson(res, 413, { ok: false, error: "Request too large." });
      return null;
    }
    sendJson(res, 400, { ok: false, error: "Unable to read request body." });
    return null;
  }

  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    sendJson(res, 400, { ok: false, error: "Invalid JSON." });
    return null;
  }
}

function inferExtensionFromMime(mime) {
  switch ((mime || "").toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "image/svg+xml":
      return ".svg";
    default:
      return "";
  }
}

function sanitizeBaseName(name) {
  const raw = String(name || "").trim();
  const withoutExt = raw.replace(/\.[a-z0-9]+$/i, "");
  const cleaned = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || "upload";
}

async function readJsonFile(filePath, fallbackValue) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

async function writeJsonFile(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2));
}

async function getBaseItems() {
  const basePath = path.join(ROOT_DIR, "assets", "timeline-data.json");
  const payload = await readJsonFile(basePath, { items: [] });
  return Array.isArray(payload.items) ? payload.items : [];
}

async function getCustomItems() {
  const items = await readJsonFile(CUSTOM_ITEMS_PATH, []);
  return Array.isArray(items) ? items : [];
}

async function getDeletedIds() {
  const ids = await readJsonFile(DELETED_IDS_PATH, []);
  return Array.isArray(ids) ? ids : [];
}

async function getTimelineData() {
  const [baseItems, customItems, deletedIds] = await Promise.all([getBaseItems(), getCustomItems(), getDeletedIds()]);
  const visibleBase = baseItems.filter((item) => !deletedIds.includes(item.id));
  return { items: [...visibleBase, ...customItems] };
}

function requireAuth(req, res) {
  if (!isLoggedIn(req)) {
    sendJson(res, 401, { ok: false, error: "Not logged in." });
    return false;
  }
  return true;
}

async function handleLogin(req, res) {
  const payload = await readJsonBody(req, res);
  if (!payload) return;

  const pass = String(payload.password || "").trim();
  if (!pass || pass !== ADMIN_PASSWORD) {
    sendJson(res, 401, { ok: false, error: "Incorrect password." });
    return;
  }

  const token = randomUUID();
  sessions.add(token);
  setCookie(res, SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: false,
    maxAge: 60 * 60 * 12
  });
  sendJson(res, 200, { ok: true });
}

async function handleLogout(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (token) sessions.delete(token);
  setCookie(res, SESSION_COOKIE, "", { path: "/", httpOnly: true, sameSite: "Lax", secure: false, maxAge: 0 });
  sendJson(res, 200, { ok: true });
}

async function handleMe(req, res) {
  sendJson(res, 200, { ok: true, loggedIn: isLoggedIn(req) });
}

async function handleTimelineData(req, res) {
  const data = await getTimelineData();
  sendJson(res, 200, data);
}

async function handleAddEvent(req, res) {
  if (!requireAuth(req, res)) return;
  const payload = await readJsonBody(req, res);
  if (!payload) return;

  const title = String(payload.title || "").trim();
  const date = String(payload.date || "").trim();
  const summary = String(payload.summary || "").trim();
  const details = String(payload.details || "").trim();
  const categories = Array.isArray(payload.categories) ? payload.categories.map((c) => String(c)).filter(Boolean) : [];
  const images = Array.isArray(payload.images) ? payload.images.map((c) => String(c)).filter(Boolean) : [];
  const videos = Array.isArray(payload.videos) ? payload.videos.map((c) => String(c)).filter(Boolean) : [];
  const links = Array.isArray(payload.links) ? payload.links : [];
  const keywords = Array.isArray(payload.keywords) ? payload.keywords.map((c) => String(c)).filter(Boolean) : [];

  if (!title || !date || !summary || !details || !categories.length) {
    sendJson(res, 400, { ok: false, error: "Missing required fields." });
    return;
  }

  const year = Number(new Date(date).getFullYear());
  const item = {
    id: `custom-${Date.now()}-${randomUUID().slice(0, 8)}`,
    date,
    year,
    title,
    summary,
    categories,
    details,
    images,
    videos,
    links,
    keywords
  };

  const items = await getCustomItems();
  items.push(item);
  await writeJsonFile(CUSTOM_ITEMS_PATH, items);
  sendJson(res, 200, { ok: true, item });
}

async function handleDeleteEvent(req, res) {
  if (!requireAuth(req, res)) return;
  const payload = await readJsonBody(req, res);
  if (!payload) return;
  const id = String(payload.id || "").trim();
  if (!id) {
    sendJson(res, 400, { ok: false, error: "Missing id." });
    return;
  }

  const customItems = await getCustomItems();
  const customIndex = customItems.findIndex((item) => item.id === id);
  if (customIndex > -1) {
    customItems.splice(customIndex, 1);
    await writeJsonFile(CUSTOM_ITEMS_PATH, customItems);
    sendJson(res, 200, { ok: true });
    return;
  }

  const deletedIds = await getDeletedIds();
  if (!deletedIds.includes(id)) {
    deletedIds.push(id);
    await writeJsonFile(DELETED_IDS_PATH, deletedIds);
  }
  sendJson(res, 200, { ok: true });
}

async function handleUpload(req, res) {
  if (!requireAuth(req, res)) return;
  const payload = await readJsonBody(req, res);
  if (!payload) return;

  const dataUrl = String(payload?.dataUrl || "");
  const originalName = payload?.filename || "upload";
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    sendJson(res, 400, { ok: false, error: "Expected a base64 data URL." });
    return;
  }

  const mime = match[1];
  const base64 = match[2];
  if (!mime.toLowerCase().startsWith("image/")) {
    sendJson(res, 400, { ok: false, error: "Only image uploads are supported." });
    return;
  }

  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    sendJson(res, 400, { ok: false, error: "Invalid base64." });
    return;
  }

  const ext = inferExtensionFromMime(mime) || path.extname(String(originalName)) || ".png";
  const base = sanitizeBaseName(originalName);
  const filename = `${base}-${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;

  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  const dest = path.join(UPLOAD_DIR, filename);
  await fsp.writeFile(dest, buffer);

  sendJson(res, 200, { ok: true, url: `/img/uploads/${filename}` });
}

async function handleStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const resolved = safeResolveUrlPath(pathname);
  if (!resolved) {
    sendText(res, 400, "Bad request.");
    return;
  }

  try {
    const stat = await fsp.stat(resolved);
    if (!stat.isFile()) {
      sendText(res, 404, "Not found.");
      return;
    }
    res.writeHead(200, {
      "content-type": getContentType(resolved),
      "content-length": stat.size
    });
    fs.createReadStream(resolved).pipe(res);
  } catch {
    sendText(res, 404, "Not found.");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url?.startsWith("/api/ping")) {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/api/me")) {
      await handleMe(req, res);
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/api/timeline-data")) {
      await handleTimelineData(req, res);
      return;
    }
    if (req.method === "POST" && req.url?.startsWith("/api/login")) {
      await handleLogin(req, res);
      return;
    }
    if (req.method === "POST" && req.url?.startsWith("/api/logout")) {
      await handleLogout(req, res);
      return;
    }
    if (req.method === "POST" && req.url?.startsWith("/api/upload-image")) {
      await handleUpload(req, res);
      return;
    }
    if (req.method === "POST" && req.url?.startsWith("/api/events")) {
      await handleAddEvent(req, res);
      return;
    }
    if (req.method === "POST" && req.url?.startsWith("/api/delete")) {
      await handleDeleteEvent(req, res);
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      await handleStatic(req, res);
      return;
    }
    res.setHeader("allow", "GET, HEAD, POST");
    sendText(res, 405, "Method not allowed.");
  } catch (error) {
    sendJson(res, 500, { ok: false, error: "Server error." });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Local server running: http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`Uploads saved to: ${path.relative(ROOT_DIR, UPLOAD_DIR)}`);
});
