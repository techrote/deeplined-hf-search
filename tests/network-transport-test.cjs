const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "streamlined-hf-model-search.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/i);
if (!script) throw new Error("Cannot locate application script");

test("complete inline application script parses", () => {
  assert.doesNotThrow(() => new vm.Script(script[1], { filename: "streamlined-hf-model-search.js" }));
});

const start = "// ── API Transport ──";
const end = "// ── Expansion Key Prefixes ──";
assert.equal(html.split(start).length, 2, "transport section marker must be unique");
const transportSource = html.split(start)[1].split(end)[0];
assert.ok(transportSource.includes("resolveHubApiUrl"));

function setup(saved = null) {
  const values = new Map();
  if (saved) values.set("deeplined-hf-transport-v1", JSON.stringify(saved));
  const context = {
    URL,
    localStorage: {
      getItem(key) { return values.get(key) || null; },
      setItem(key, value) { values.set(key, value); }
    }
  };
  vm.runInNewContext(transportSource +
    "\n globalThis.transportTest = { normalizeGatewayOrigin, resolveHubApiUrl, readTransportPreference, " +
    "set(mode, origin) { _transportMode = mode; _gatewayOrigin = origin; } };", context);
  return context.transportTest;
}

test("direct mode preserves original URLs and remains the default", () => {
  const api = setup();
  assert.equal(api.readTransportPreference().mode, "direct");
  const input = "https://huggingface.co/api/models?limit=3";
  assert.equal(api.resolveHubApiUrl(input), input);
});

test("gateway mode maps model discovery, detail, and cards without dropping queries", () => {
  const api = setup();
  api.set("gateway", "https://models.example");
  const cases = [
    ["/api/models?search=qwen&limit=100&cardData=true", "/api/models?search=qwen&limit=100&cardData=true"],
    ["/api/models/Qwen/Qwen3?full=true", "/api/models/Qwen/Qwen3?full=true"],
    ["/Qwen/Qwen3/raw/main/README.md", "/Qwen/Qwen3/raw/main/README.md"]
  ];
  for (const [input, expected] of cases) {
    assert.equal(api.resolveHubApiUrl("https://huggingface.co" + input), "https://models.example" + expected);
  }
  assert.equal(api.resolveHubApiUrl("https://example.org/api/models"), "https://example.org/api/models");
});

test("bad gateway configurations are refused", () => {
  const api = setup();
  for (const input of [
    "", "javascript:alert(1)", "http://example.org", "https://example.org/route",
    "https://name:pw@example.org", "https://example.org?x=1", "https://example.org/#part"
  ]) {
    assert.throws(() => api.normalizeGatewayOrigin(input), input);
  }
  assert.equal(api.normalizeGatewayOrigin("https://catalogue.example.org/"), "https://catalogue.example.org");
  assert.equal(api.normalizeGatewayOrigin("http://localhost:8787"), "http://localhost:8787");
  assert.equal(api.normalizeGatewayOrigin("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
});

test("saved settings are validated and invalid stored endpoints fall back to direct", () => {
  const valid = setup({ mode: "gateway", origin: "https://catalogue.example" });
  assert.equal(valid.readTransportPreference().origin, "https://catalogue.example");
  const invalid = setup({ mode: "gateway", origin: "http://untrusted.example" });
  assert.equal(invalid.readTransportPreference().mode, "direct");
});

test("switching transport without a configured gateway fails visibly", () => {
  const api = setup();
  api.set("gateway", "");
  assert.throws(() => api.resolveHubApiUrl("https://huggingface.co/api/models"), /required/);
});

test("existing fetch queue delegates URL resolution before deduplication", () => {
  assert.match(script[1], /function fetchJson\(url\)\s*\{\s*try \{ url = resolveHubApiUrl\(url\); \}/);
  assert.match(script[1], /function _initApp\(\)\s*\{\s*setupApiConnectionControls\(\);/);
  assert.ok(html.includes('id="api-transport-apply"'));
  assert.ok(html.includes('id="api-transport-test"'));
});
