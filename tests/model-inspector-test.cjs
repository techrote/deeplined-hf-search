const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "streamlined-hf-model-search.html"), "utf8");
const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
if (!script) throw new Error("Missing standalone application script");
const start = "// ── Model Inspector (API-only) ──";
const end = "// ── RenderCoordinator Method Wiring ──";
const section = html.split(start)[1]?.split(end)[0];
if (!section) throw new Error("Missing model inspector section");

function makeInspector(fetchJson) {
  const context = { URL, fetchJson: fetchJson || (async () => []), navigator: {} };
  const exportNames = [
    "normalizeInspectorModelId", "inspectorApiUrl", "validInspectorFilePath",
    "inspectorDownloadUrl", "inspectorIsWeight", "buildInspectorManifest",
    "inspectorFileSizeLabel", "inspectorFetchModelInfo"
  ];
  vm.runInNewContext(section + "\nglobalThis.inspectorFunctions = {" +
    exportNames.join(",") + "};", context);
  return context.inspectorFunctions;
}

test("the complete HTML app still parses as a standalone script", () => {
  assert.doesNotThrow(() => new vm.Script(script[1]));
  assert.match(html, /const APP_VERSION = '261023\.02'/);
});

test("model identity validation is strict and case-preserving", () => {
  const h = makeInspector();
  assert.equal(h.normalizeInspectorModelId(" Qwen/Qwen2.5-7B-Instruct "), "Qwen/Qwen2.5-7B-Instruct");
  assert.equal(h.inspectorApiUrl("Qwen/Qwen3"), "https://huggingface.co/api/models/Qwen/Qwen3");
  for (const name of ["", "Qwen", "/model", "owner/", "a/b/c", "../repo", "o/..", "o/%2fadmin", "https://example.com/a/b"]) {
    assert.throws(() => h.normalizeInspectorModelId(name), name);
  }
});

test("download links are direct, encoded, and pinned to the repository SHA", () => {
  const h = makeInspector();
  const revision = "a".repeat(40);
  assert.equal(
    h.inspectorDownloadUrl("Qwen/Qwen3", revision, "weights/model (q4).gguf"),
    "https://huggingface.co/Qwen/Qwen3/resolve/" + revision +
      "/weights/model%20(q4).gguf?download=true"
  );
  assert.equal(
    h.inspectorDownloadUrl("Owner/Model", "main", "config.json"),
    "https://huggingface.co/Owner/Model/resolve/main/config.json?download=true"
  );
});

test("unsafe repository paths and arbitrary revisions never become download links", () => {
  const h = makeInspector();
  for (const pathName of ["", "../private", "weights/../../other", "/weights", "models//test.bin", "a\\b", "file\nname"]) {
    assert.equal(h.validInspectorFilePath(pathName), false, pathName);
    assert.throws(() => h.inspectorDownloadUrl("a/b", "main", pathName));
  }
  for (const revision of ["", "../../main", "refs/pr/1", "v1", "https://evil.example"]) {
    assert.throws(() => h.inspectorDownloadUrl("a/b", revision, "weights.gguf"), revision);
  }
});

test("merges API siblings with optional tree sizes and does not manufacture file entries", () => {
  const h = makeInspector();
  const files = h.buildInspectorManifest([
    { rfilename: "config.json" },
    { rfilename: "shards/model-00001.safetensors" },
    { rfilename: "model.gguf", size: 0 },
    { rfilename: "bad/../file.bin" }
  ], [
    { type: "file", path: "shards/model-00001.safetensors", size: 123456789 },
    { type: "file", path: "model.gguf", size: 3500 },
    { type: "directory", path: "ignore" },
    { type: "file", path: "tokenizer.json", size: 1000 }
  ]);
  const sorted = JSON.parse(JSON.stringify(files));
  assert.deepEqual(sorted.map(x => x.path), [
    "model.gguf", "shards/model-00001.safetensors", "config.json", "tokenizer.json"
  ]);
  assert.equal(sorted.find(x => x.path === "model.gguf").size, 3500);
  assert.equal(sorted.find(x => x.path === "shards/model-00001.safetensors").size, 123456789);
  assert.equal(sorted.find(x => x.path === "config.json").size, null);
});

test("file-size labels and weight classification are reliable", () => {
  const h = makeInspector();
  assert.equal(h.inspectorFileSizeLabel(null), "—");
  assert.equal(h.inspectorFileSizeLabel(0), "0 B");
  assert.equal(h.inspectorFileSizeLabel(1073741824), "1.00 GiB");
  assert.equal(h.inspectorIsWeight("weights/model.Q4_K_M.gguf"), true);
  assert.equal(h.inspectorIsWeight("model-00001-of-00002.safetensors"), true);
  assert.equal(h.inspectorIsWeight("README.md"), false);
  assert.equal(h.inspectorIsWeight("tokenizer.json"), false);
});

test("model lookup uses the details endpoint first", async () => {
  const calls = [];
  const h = makeInspector(async (url) => {
    calls.push(url);
    return { id: "Qwen/Qwen3", sha: "f".repeat(40) };
  });
  const res = await h.inspectorFetchModelInfo("Qwen/Qwen3");
  assert.equal(res.partial, false);
  assert.equal(res.info.id, "Qwen/Qwen3");
  assert.deepEqual(calls, ["https://huggingface.co/api/models/Qwen/Qwen3?full=true&cardData=true"]);
});

test("if detail lookup fails, exact model metadata falls back to listing API", async () => {
  const calls = [];
  const h = makeInspector(async (url) => {
    calls.push(url);
    if (url.includes("/api/models/")) throw new Error("detail unavailable");
    return [
      { id: "Another/Model" },
      { id: "Qwen/Qwen3", downloads: 55, cardData: { license: "apache-2.0" } }
    ];
  });
  const result = await h.inspectorFetchModelInfo("Qwen/Qwen3");
  assert.equal(result.partial, true);
  assert.equal(result.info.id, "Qwen/Qwen3");
  assert.match(calls[1], /\/api\/models\?search=Qwen%2FQwen3/);
});

test("listing fallback refuses unrelated models", async () => {
  const h = makeInspector(async url => {
    if (url.includes("/api/models/")) throw new Error("detail unavailable");
    return [{ id: "Different/Model" }];
  });
  await assert.rejects(h.inspectorFetchModelInfo("Qwen/Qwen3"), /detail unavailable/);
});

test("both main tables expose Inspect without duplicating lifecycle or external dependencies", () => {
  assert.match(html, /data-inspect-model="\$\{escapeHtml\(m\.id\)\}"/);
  assert.match(html, /data-inspect-model="\$\{escapeHtml\(q\.id\)\}"/);
  assert.match(script[1], /function _initApp\(\)\s*\{\s*setupApiConnectionControls\(\);\s*setupModelInspector\(\)/);
  assert.match(script[1], /"main-table"\)\.addEventListener\("click", event =>[\s\S]*?event\.stopPropagation\(\)/);
  assert.match(html, /id="model-inspector"/);
  assert.match(html, /id="inspector-file-rows"/);
});
