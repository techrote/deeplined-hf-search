# Optional metadata transport

Deeplined supports two API sources:

- Direct (default): requests go to the public Hugging Face Hub API.
- HTTPS metadata gateway: requests go to a user-configured origin.

Open **API Connection**, enter a gateway origin, apply the change, and test
connectivity. The selection persists in browser storage where available.
Changing source resets cached results and cancels active searches.

The optional service lives in [gateway/](../gateway/README.md). It exposes a
small, read-only model-metadata API including search, model details, and
text model cards. It is designed for reusable model-catalogue tools, including
university and research workflows. Its route allowlist does not include model
weights, repository mutations or arbitrary URL forwarding.

The HTML file works without a gateway. No local services, drivers or system
network configuration changes are required.

## Regression tests

Run:

    node --test tests/network-transport-test.cjs tests/gateway-test.mjs
    node tests/phase5-test.js

See [gateway/README.md](../gateway/README.md) for deployment and limits.
