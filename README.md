# cloudflare-codemode-bash

A Claude Code skill for interacting with the entire Cloudflare API using bash + Node.js — no MCP server required.

Mirrors the "codemode" approach from the official [cloudflare/mcp](https://github.com/cloudflare/mcp) server: search a local pre-processed OpenAPI spec to find the right endpoint, then execute a Node script against the live API.

## How it works

Two steps, same as the official Cloudflare MCP codemode server:

1. **Search** — query `~/.cache/cloudflare-spec-processed.json` with a Node snippet to find endpoints
2. **Execute** — run a Node script against `api.cloudflare.com` using your API token

The `process-spec.js` script mirrors `cloudflare/mcp`'s `spec-processor.ts`: it resolves all `$ref` pointers inline and injects synthetic product tags, so searches work cleanly without manual schema lookups.

## Setup

```bash
# 1. Set env vars
export CLOUDFLARE_API_TOKEN=your_token_here
export CLOUDFLARE_ACCOUNT_ID=your_account_id_here

# 2. Download raw spec (~9MB)
curl -s -o ~/.cache/cloudflare-spec.json \
  https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json

# 3. Pre-process (resolves $refs, injects product tags, ~33MB output)
node process-spec.js
```

## Install

Clone and drop the skill folder into `~/.claude/skills/`:

```bash
git clone https://github.com/Ankcorn/cloudflare-codemode-bash
cp -r cloudflare-codemode-bash ~/.claude/skills/cloudflare-api
```

Or in Claude Code:
```
/plugin install cloudflare-codemode-bash@Ankcorn
```

## Files

- `SKILL.md` — skill instructions and metadata Claude uses
- `process-spec.js` — pre-processes the raw Cloudflare OpenAPI spec

## Requirements

- Node.js 18+
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your environment
- Cloudflare OpenAPI spec cached locally (see setup above)

## License

MIT
