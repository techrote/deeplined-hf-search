// Read-only Hugging Face model metadata relay.
// Only fixed, validated Hub routes are accepted. Model weights are never forwarded.
const HUB_ORIGIN = "https://huggingface.co";
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_CARD_BYTES = 1024 * 1024;
const QUERY_KEYS = new Set([
  "sort", "direction", "limit", "pipeline_tag", "full", "cardData",
  "search", "author", "filter", "library", "language", "gated",
  "config", "blobs", "expand", "revision", "recursive", "cursor"
]);

function safeSegment(raw) {
  try {
    const text = decodeURIComponent(raw);
    return text.length > 0 && text.length <= 128 &&
      /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(text) &&
      text !== "." && text !== "..";
  } catch {
    return false;
  }
}

function classifyPath(pathname) {
  const segments = pathname.split("/").slice(1);
  if (segments[0] === "api" && segments[1] === "models") {
    if (segments.length === 2) return "models";
    if (segments.length === 4 && safeSegment(segments[2]) && safeSegment(segments[3])) return "model";
    if (segments.length === 6 && safeSegment(segments[2]) && safeSegment(segments[3]) &&
        (segments[4] === "tree" || segments[4] === "revision") && safeSegment(segments[5])) return "model";
  }
  if (segments.length === 5 && safeSegment(segments[0]) && safeSegment(segments[1]) &&
      (segments[2] === "raw" || segments[2] === "resolve") &&
      safeSegment(segments[3]) && segments[4] === "README.md") return "card";
  return null;
}

function validateQuery(url, route) {
  if (url.search.length > 4096 || [...url.searchParams].length > 16) return false;
  if (route === "card" && url.search) return false;
  for (const [key, value] of url.searchParams) {
    if (!QUERY_KEYS.has(key) || value.length > 256) return false;
    if (key === "limit" && (!/^[0-9]+$/.test(value) || +value < 1 || +value > 1000)) return false;
  }
  return true;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (allowed.length && origin && !allowed.includes(origin)) return null;
  const headers = {
    "Access-Control-Allow-Origin": allowed.length ? (origin || allowed[0]) : "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Max-Age": "600"
  };
  if (allowed.length) headers.Vary = "Origin";
  return headers;
}

function respond(status, value, cors, extra = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...cors,
      ...extra,
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store"
    }
  });
}

// Bound response memory even when an upstream omits or misstates Content-Length.
async function readLimited(response, byteLimit) {
  const advertised = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertised) && advertised > byteLimit) throw new RangeError("response_too_large");
  if (!response.body || typeof response.body.getReader !== "function") {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > byteLimit) throw new RangeError("response_too_large");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > byteLimit) throw new RangeError("response_too_large");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    combined.set(chunk, position);
    position += chunk.byteLength;
  }
  return combined;
}

export default {
  async fetch(request, env = {}) {
    const cors = corsHeaders(request, env);
    if (!cors) return respond(403, { error: "origin_not_allowed" }, {});

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Cache-Control": "no-store" } });
    }
    if (request.method !== "GET") {
      return respond(405, { error: "method_not_allowed" }, cors, { Allow: "GET, OPTIONS" });
    }

    let url;
    try {
      url = new URL(request.url);
    } catch {
      return respond(400, { error: "invalid_url" }, cors);
    }

    if (url.pathname === "/health" && !url.search) {
      return respond(200, { status: "ok", service: "deeplined-hf-metadata", api: 1 }, cors);
    }

    const route = classifyPath(url.pathname);
    if (!route || !validateQuery(url, route)) {
      return respond(400, { error: "unsupported_metadata_route" }, cors);
    }

    const upstreamUrl = HUB_ORIGIN + url.pathname + url.search;
    const ttl = route === "card" ? 900 : route === "models" ? 90 : 300;
    let upstream;
    try {
      upstream = await fetch(upstreamUrl, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: route === "card" ? "text/plain" : "application/json" },
        cf: { cacheEverything: true, cacheTtl: ttl }
      });
    } catch {
      return respond(502, { error: "upstream_unavailable" }, cors);
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      return respond(502, { error: "upstream_redirect_rejected" }, cors);
    }

    let bytes;
    try {
      bytes = await readLimited(upstream, route === "card" ? MAX_CARD_BYTES : MAX_JSON_BYTES);
    } catch (error) {
      if (error instanceof RangeError) return respond(413, { error: "response_too_large" }, cors);
      return respond(502, { error: "upstream_read_failed" }, cors);
    }

    const headers = {
      ...cors,
      "Content-Type": route === "card" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
      "Cache-Control": upstream.ok ? "public, max-age=" + ttl : "no-store",
      "X-Content-Type-Options": "nosniff"
    };
    const retryAfter = upstream.headers.get("retry-after");
    if (upstream.status === 429 && retryAfter && /^[0-9]{1,5}$/.test(retryAfter)) {
      headers["Retry-After"] = retryAfter;
    }
    return new Response(bytes, { status: upstream.status, headers });
  }
};
