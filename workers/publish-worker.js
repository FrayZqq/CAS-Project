const jsonResponse = (status, payload, corsHeaders) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders
    }
  });

const getCorsHeaders = (env) => {
  const origin = env.CORS_ORIGIN && env.CORS_ORIGIN.trim() ? env.CORS_ORIGIN.trim() : "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
};

const base64Encode = (value) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
};

const buildContentsUrl = (owner, repo, path) => {
  const encodedPath = path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;
};

export default {
  async fetch(request, env) {
    const corsHeaders = getCorsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/publish" || request.method !== "POST") {
      return jsonResponse(404, { ok: false, error: "Not found." }, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch (error) {
      return jsonResponse(400, { ok: false, error: "Invalid JSON body." }, corsHeaders);
    }

    const password = String(body?.password || "");
    if (!env.PUBLISH_PASSWORD || password !== env.PUBLISH_PASSWORD) {
      return jsonResponse(401, { ok: false, error: "Unauthorized." }, corsHeaders);
    }

    const payload = body?.data;
    if (!payload || !Array.isArray(payload.items)) {
      return jsonResponse(400, { ok: false, error: "Missing timeline data." }, corsHeaders);
    }

    const owner = env.GITHUB_OWNER;
    const repo = env.GITHUB_REPO;
    const path = env.GITHUB_PATH || "assets/timeline-data.json";
    const branch = env.GITHUB_BRANCH || "main";
    const token = env.GITHUB_TOKEN;

    if (!owner || !repo || !token) {
      return jsonResponse(500, { ok: false, error: "Server not configured." }, corsHeaders);
    }

    const apiUrl = buildContentsUrl(owner, repo, path);
    const authHeaders = {
      Authorization: `Bearer ${token}`,
      "User-Agent": "cas-timeline-publisher",
      Accept: "application/vnd.github+json"
    };

    const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, {
      headers: authHeaders
    });

    if (!getRes.ok) {
      const text = await getRes.text();
      return jsonResponse(502, { ok: false, error: "Failed to read repo file.", details: text }, corsHeaders);
    }

    const existing = await getRes.json();
    const sha = existing?.sha;
    if (!sha) {
      return jsonResponse(502, { ok: false, error: "Missing file sha." }, corsHeaders);
    }

    const content = base64Encode(JSON.stringify(payload, null, 2));
    const message = env.GITHUB_MESSAGE || "Update timeline data";
    const committerName = env.GITHUB_COMMITTER_NAME || "CAS Timeline Bot";
    const committerEmail = env.GITHUB_COMMITTER_EMAIL || "timeline-bot@users.noreply.github.com";

    const putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message,
        content,
        sha,
        branch,
        committer: { name: committerName, email: committerEmail }
      })
    });

    if (!putRes.ok) {
      const text = await putRes.text();
      return jsonResponse(502, { ok: false, error: "Failed to write repo file.", details: text }, corsHeaders);
    }

    return jsonResponse(200, { ok: true }, corsHeaders);
  }
};
