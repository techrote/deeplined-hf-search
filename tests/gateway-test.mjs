import test from "node:test";
import assert from "node:assert/strict";
import worker from "../gateway/src/worker.mjs";

const ORIGIN = "https://catalogue.example.test";

async function invoke(path, options = {}) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (options.failure) throw new Error("network unavailable");
    return options.upstream || new Response(JSON.stringify([{ id: "Qwen/Qwen3" }]), {
      status: 200, headers: { "content-type": "application/json" }
    });
  };
  try {
    const headers = options.origin ? { Origin: options.origin } : {};
    const response = await worker.fetch(new Request(ORIGIN + path, {
      method: options.method || "GET", headers
    }), options.env || {});
    return { response, calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("health check is self-contained and CORS accessible", async () => {
  const { response, calls } = await invoke("/health", { origin: "null" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal((await response.json()).status, "ok");
  assert.equal(calls.length, 0);
});

test("proxies a model-search JSON request to the fixed upstream only", async () => {
  const result = await invoke("/api/models?search=Qwen&sort=downloads&limit=100&full=true&cardData=true");
  assert.equal(result.response.status, 200);
  assert.deepEqual(await result.response.json(), [{ id: "Qwen/Qwen3" }]);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].url,
    "https://huggingface.co/api/models?search=Qwen&sort=downloads&limit=100&full=true&cardData=true");
  assert.equal(result.calls[0].init.redirect, "manual");
  assert.equal(result.calls[0].init.method, "GET");
  assert.equal(result.calls[0].init.headers.Authorization, undefined);
});

test("permits a model detail and a revision tree request", async () => {
  for (const path of [
    "/api/models/Qwen/Qwen3?full=true",
    "/api/models/Qwen/Qwen3/tree/main",
    "/api/models/Qwen/Qwen3/revision/main"
  ]) {
    const { response, calls } = await invoke(path);
    assert.equal(response.status, 200, path);
    assert.equal(calls.length, 1, path);
  }
});

test("returns a model card as plain text without following redirects", async () => {
  for (const verb of ["raw", "resolve"]) {
    const { response, calls } = await invoke("/Qwen/Qwen3/" + verb + "/main/README.md", {
      upstream: new Response("# Card", { headers: { "content-type": "text/plain" } })
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "# Card");
    assert.match(response.headers.get("content-type"), /^text\/plain/);
    assert.equal(calls[0].init.headers.Accept, "text/plain");
  }
});

test("rejects everything except allowlisted metadata and model-card paths", async () => {
  for (const path of [
    "/", "/api/datasets", "/api/models/Qwen", "/api/models/Qwen/Qwen3/delete",
    "/Qwen/Qwen3/resolve/main/model.safetensors", "/Qwen/Qwen3/raw/main/config.json",
    "/api/models/Qwen/Qwen3/tree/main/files/weights",
    "/api/models/Qwen/%2Fetc", "/api/models/Qwen/Qwen3?destination=http%3A%2F%2Flocalhost",
    "/api/models?limit=1001", "/api/models?limit=-1", "/api/models?search=" + "x".repeat(257)
  ]) {
    const { response, calls } = await invoke(path);
    assert.equal(response.status, 400, path);
    assert.equal(calls.length, 0, path);
  }
});

test("origin allowlist is respected, but preflight does not forward", async () => {
  const env = { ALLOWED_ORIGINS: "https://research.example,null" };
  const rejected = await invoke("/api/models", { origin: "https://other.example", env });
  assert.equal(rejected.response.status, 403);
  assert.equal(rejected.calls.length, 0);
  const allowed = await invoke("/api/models", { origin: "null", env });
  assert.equal(allowed.response.headers.get("access-control-allow-origin"), "null");
  assert.equal(allowed.response.headers.get("vary"), "Origin");
  const preflight = await invoke("/api/models", {
    origin: "https://research.example", env, method: "OPTIONS"
  });
  assert.equal(preflight.response.status, 204);
  assert.equal(preflight.calls.length, 0);
});

test("refuses methods that could mutate upstream state", async () => {
  const { response, calls } = await invoke("/api/models", { method: "POST" });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, OPTIONS");
  assert.equal(calls.length, 0);
});

test("rejects upstream redirects instead of expanding destination scope", async () => {
  const { response } = await invoke("/Qwen/Qwen3/resolve/main/README.md", {
    upstream: new Response(null, {
      status: 302,
      headers: { location: "https://objects.example.test/model.safetensors" }
    })
  });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "upstream_redirect_rejected");
});

test("enforces bounded bodies with and without a length header", async () => {
  const advertised = await invoke("/api/models", {
    upstream: new Response("small", {
      headers: { "content-length": "90000000" }
    })
  });
  assert.equal(advertised.response.status, 413);

  const streamed = await invoke("/Qwen/Qwen3/raw/main/README.md", {
    upstream: new Response("x".repeat(1024 * 1024 + 1))
  });
  assert.equal(streamed.response.status, 413);
});

test("preserves upstream 429 status and Retry-After", async () => {
  const { response } = await invoke("/api/models", {
    upstream: new Response('{"error":"rate limited"}', {
      status: 429, headers: { "retry-after": "42" }
    })
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "42");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("network failures report a bounded gateway error", async () => {
  const { response } = await invoke("/api/models", { failure: true });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "upstream_unavailable");
});
