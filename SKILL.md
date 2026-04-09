---
name: cloudflare-api
description: Use when you need to interact with the Cloudflare API — searching for endpoints, creating/updating tokens, managing Workers, KV, R2, D1, DNS, or any other Cloudflare resource. Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment. Uses bash + node to search a local pre-processed OpenAPI spec and execute API calls directly — no MCP server needed.
---

# Cloudflare API Skill

Interact with the Cloudflare API using bash and Node.js. Two-step approach: search the pre-processed OpenAPI spec to find the right endpoint, then execute a Node script against the live API.

## Prerequisites

Set in your environment (e.g. `~/.env` or `~/.bashrc`):
```bash
export CLOUDFLARE_API_TOKEN=your_token_here
export CLOUDFLARE_ACCOUNT_ID=your_account_id_here
```

Download and pre-process the Cloudflare OpenAPI spec (refresh periodically):
```bash
# 1. Download raw spec (~9MB)
curl -s -o ~/.cache/cloudflare-spec.json \
  https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json

# 2. Pre-process: resolves all $refs inline, extracts product tags (~33MB)
node /path/to/process-spec.js
```

The `process-spec.js` script is in this skill folder. It mirrors the approach used by the official `cloudflare/mcp` server's `spec-processor.ts`:
- Resolves all `$ref` pointers inline — no more manual `spec.components.schemas` lookups
- Injects a synthetic `product` tag derived from the path (e.g. `/accounts/{id}/workers/...` → tag `"workers"`)
- Extracts a `products` array sorted by endpoint count for quick discovery

Use `~/.cache/cloudflare-spec-processed.json` for all searches.

## Step 1: Search the processed spec

Always write to a temp file — template literals break in bash `-e` strings.

### Discover available products
```bash
node -e "
const s = require(process.env.HOME + '/.cache/cloudflare-spec-processed.json');
console.log(s.products.join(', '));
"
```

### Find endpoints by product/keyword
```bash
cat > /tmp/cf-search.js << 'EOF'
const spec = require(process.env.HOME + "/.cache/cloudflare-spec-processed.json");
const results = [];
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    if (op.tags?.includes("workers") && method === "post") {
      results.push({ method: method.toUpperCase(), path, summary: op.summary });
    }
  }
}
console.log(JSON.stringify(results, null, 2));
EOF
bash -i -c 'node /tmp/cf-search.js' 2>/dev/null
```

### Inspect a specific endpoint (parameters and requestBody are fully resolved — no $refs)
```bash
cat > /tmp/cf-inspect.js << 'EOF'
const spec = require(process.env.HOME + "/.cache/cloudflare-spec-processed.json");
const op = spec.paths["/accounts/{account_id}/workers/scripts"]?.get;
console.log(JSON.stringify({
  summary: op?.summary,
  parameters: op?.parameters,
  requestBody: op?.requestBody,
}, null, 2));
EOF
bash -i -c 'node /tmp/cf-inspect.js' 2>/dev/null
```

All `$refs` are resolved inline in the processed spec — `parameters`, `requestBody`, and `responses` contain full schemas directly.

## Step 2: Execute against the API

```bash
cat > /tmp/cf-exec.js << 'EOF'
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

async function main() {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  console.log(JSON.stringify(data.result?.map(s => s.id), null, 2));
}
main().catch(console.error);
EOF
bash -i -c 'node /tmp/cf-exec.js' 2>/dev/null
```

All Cloudflare REST responses: `{ success, result, errors, messages }`

## Token management

### List permission group IDs (NOT in the spec — fetch live)
```bash
cat > /tmp/cf-perms.js << 'EOF'
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
async function main() {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/permission_groups`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  console.log(JSON.stringify(data.result?.filter(g => g.name.toLowerCase().includes("workers")), null, 2));
}
main().catch(console.error);
EOF
bash -i -c 'node /tmp/cf-perms.js' 2>/dev/null
```

### Create / Update token
- Create: `POST /accounts/{account_id}/tokens`
- Update: `PUT /accounts/{account_id}/tokens/{token_id}` — **full replace**, must resend complete `policies` array
- Required fields on PUT: `name`, `status` (`"active"`/`"disabled"`), `policies`

## Gotchas

- Use `/accounts/{account_id}/tokens` — NOT `/user/tokens` (requires email+key auth, not API token)
- Always use a temp file — template literals with `${var}` break inside bash `-e` strings
- PUT on tokens is a full replace — always include all permission groups
- `bash -i -c 'node /tmp/script.js'` ensures `~/.bashrc` is sourced so env vars load
- Permission group IDs are not in the OpenAPI spec — always fetch them live
