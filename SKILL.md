---
name: cloudflare-api
description: Use when you need to interact with the Cloudflare API — searching for endpoints, creating/updating tokens, managing Workers, KV, R2, D1, DNS, or any other Cloudflare resource. Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment. Uses bash + node to search a local OpenAPI spec and execute API calls directly — no MCP server needed.
---

# Cloudflare API Skill

Interact with the Cloudflare API using bash and Node.js. Two-step approach: search the OpenAPI spec to find the right endpoint, then execute a Node script against the live API.

## Prerequisites

Set in your environment (e.g. `~/.env` or `~/.bashrc`):
```bash
export CLOUDFLARE_API_TOKEN=your_token_here
export CLOUDFLARE_ACCOUNT_ID=your_account_id_here
```

Cache the Cloudflare OpenAPI spec locally (refresh periodically):
```bash
curl -s -o ~/.cache/cloudflare-spec.json \
  https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json
```

## Step 1: Search the spec

Find the right endpoint before calling it. Always write to a temp file to avoid shell escaping issues:

```bash
cat > /tmp/cf-search.js << 'EOF'
const spec = require(process.env.HOME + "/.cache/cloudflare-spec.json");
const results = [];
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    // Edit this condition to match what you're looking for
    if (path.includes("workers") && method === "get") {
      results.push({ method: method.toUpperCase(), path, summary: op.summary });
    }
  }
}
console.log(JSON.stringify(results.slice(0, 20), null, 2));
EOF
bash -i -c 'node /tmp/cf-search.js' 2>/dev/null
```

To inspect a specific endpoint's request body schema:
```bash
cat > /tmp/cf-inspect.js << 'EOF'
const spec = require(process.env.HOME + "/.cache/cloudflare-spec.json");
const op = spec.paths["/accounts/{account_id}/workers/scripts"]?.get;
console.log(JSON.stringify({ summary: op?.summary, parameters: op?.parameters, requestBody: op?.requestBody }, null, 2));
EOF
bash -i -c 'node /tmp/cf-inspect.js' 2>/dev/null
```

Note: `spec.paths` may contain `$ref` strings pointing to `spec.components.schemas`. Resolve them manually if needed:
```js
const resolved = spec.components.schemas["schema_name"];
```

## Step 2: Execute against the API

Always use a temp file — template literals break in `-e` strings.

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

All Cloudflare REST responses have the shape:
```json
{ "success": true, "result": ..., "errors": [], "messages": [] }
```

## Token management

### List permission group IDs (required for token create/update)
Permission group IDs are NOT in the OpenAPI spec — fetch them live:
```bash
cat > /tmp/cf-perms.js << 'EOF'
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
async function main() {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/permission_groups`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  // Filter by name to find what you need, e.g.:
  console.log(JSON.stringify(data.result?.filter(g => g.name.toLowerCase().includes("workers")), null, 2));
}
main().catch(console.error);
EOF
bash -i -c 'node /tmp/cf-perms.js' 2>/dev/null
```

### Create a token
`POST /accounts/{account_id}/tokens`

### Update a token (extend/change permissions)
`PUT /accounts/{account_id}/tokens/{token_id}`

PUT is a **full replace** — resend `name`, `status`, and the complete `policies` array with all desired permission groups merged in. Partial updates are not supported.

```bash
cat > /tmp/cf-update-token.js << 'EOF'
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const tokenId = "YOUR_TOKEN_ID";

async function main() {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/${tokenId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "my-token",
      status: "active",
      policies: [{
        effect: "allow",
        resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
        permission_groups: [
          { id: "PERMISSION_GROUP_ID_1" },
          { id: "PERMISSION_GROUP_ID_2" },
        ]
      }]
    })
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
main().catch(console.error);
EOF
bash -i -c 'node /tmp/cf-update-token.js' 2>/dev/null
```

## Gotchas

- Use `/accounts/{account_id}/tokens` — NOT `/user/tokens` (that requires email+key auth, not an API token)
- Always use a temp file for scripts — template literals with `${var}` break inside bash `-e` strings
- PUT on tokens is a full replace — always include the full `policies` array
- `status` field is required on PUT: `"active"` or `"disabled"`
- Permission group IDs are not in the OpenAPI spec — always fetch them live
- `bash -i -c 'node /tmp/script.js'` ensures `~/.bashrc` is sourced so env vars are available
