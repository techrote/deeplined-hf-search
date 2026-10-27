# Optional model-metadata gateway

The gateway is a small, independent Cloudflare Worker for **read-only model discovery**.
It is entirely optional. The Deeplined HTML file retains its existing direct mode.

## Routes

- GET /health — connectivity check
- GET /api/models?... — model discovery
- GET /api/models/{author}/{model}?... — individual model information
- GET /api/models/{author}/{model}/tree/{revision} — repository file listing
- GET /api/models/{author}/{model}/revision/{revision} — revision information
- GET /{author}/{model}/raw/{revision}/README.md — model card text
- GET /{author}/{model}/resolve/{revision}/README.md — model card text

No arbitrary URLs, non-model Hub APIs, model weights, repository blobs,
mutations, forwarding of authentication headers, or redirects are supported.
Requested model identifiers and revision segments are validated. All output is
limited in size (5 MiB JSON, 1 MiB model cards).

The gateway is useful for researchers, universities, filtered network environments,
custom model discovery tools, and read-only catalogue integrations.

## Deploy

1. Review the route allowlist and the deployment's access policy.
2. Authenticate Wrangler with your own Cloudflare account.
3. Run from the repository root:

       npx wrangler deploy --config gateway/wrangler.toml

4. Copy the resulting HTTPS origin into Deeplined's **API Connection** settings,
   choose **HTTPS gateway**, then click **Apply** and **Test connection**.

The application never changes DNS, routing, the OS proxy, or VPN configuration.
Direct mode remains the default; no gateway is deployed automatically.

## Configuration and operational limits

- ALLOWED_ORIGINS is a comma-separated list of exact browser origins (for
  example https://example.org,null). An empty list allows all origins, including
  local file pages. Origin restrictions are **not authentication**: non-browser
  clients can omit or forge the Origin header.
- Before operating a public endpoint, configure appropriate Cloudflare
  application-layer rate limits or access controls and monitor request volume.
- The Worker enforces path, query, method, redirect and size restrictions.
- Response caching requests use Cloudflare's fetch cache settings (90 seconds
  for listings, 300 seconds for details, 900 seconds for model cards).
- Model-card responses are plain text, not rendered HTML. Any future model-card
  viewer must sanitize untrusted Markdown/HTML.
- This is not an authenticated gateway for gated or private models. Model
  downloads should use their original source links and permitted access paths.
- If a provider changes an API response or redirects a card request, the
  Worker intentionally fails closed until the relevant route can be reviewed.
- The frontend's browser-origin and HTTPS policies still apply. Check that the
  gateway URL is permitted by the environment where the browser is running.

## Local tests

Run from the repository root:

    node --test tests/gateway-test.mjs

This uses Node.js 20+ built-in test tools; it does not contact Hugging Face or
require Cloudflare credentials. See ../DESIGN.md for integration notes.
