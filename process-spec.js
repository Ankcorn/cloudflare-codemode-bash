#!/usr/bin/env node
/**
 * Pre-processes the raw Cloudflare OpenAPI spec:
 * - Resolves all $refs inline (no more manual spec.components.schemas lookups)
 * - Extracts only fields needed for search (summary, description, tags, parameters, requestBody, responses)
 * - Injects a synthetic "product" tag derived from the path (e.g. /accounts/{id}/workers → "workers")
 * - Writes processed spec to ~/.cache/cloudflare-spec-processed.json
 *
 * Run after downloading the raw spec:
 *   node process-spec.js
 */

const fs = require('fs');
const path = require('path');

const RAW = path.join(process.env.HOME, '.cache/cloudflare-spec.json');
const OUT = path.join(process.env.HOME, '.cache/cloudflare-spec-processed.json');

const spec = JSON.parse(fs.readFileSync(RAW, 'utf-8'));

function extractProduct(p) {
  const m = p.match(/\/accounts\/\{[^}]+\}\/([^/]+)/) || p.match(/\/zones\/\{[^}]+\}\/([^/]+)/);
  return m ? m[1] : undefined;
}

function resolveRefs(obj, seen = new Set()) {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(i => resolveRefs(i, seen));
  if ('$ref' in obj && typeof obj.$ref === 'string') {
    const ref = obj.$ref;
    if (seen.has(ref)) return { $circular: ref };
    seen.add(ref);
    const parts = ref.replace('#/', '').split('/');
    let resolved = spec;
    for (const part of parts) resolved = resolved?.[part];
    const result = resolveRefs(resolved, seen);
    seen.delete(ref);
    return result;
  }
  const result = {};
  for (const [k, v] of Object.entries(obj)) result[k] = resolveRefs(v, seen);
  return result;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const paths = {};

for (const [p, pathItem] of Object.entries(spec.paths || {})) {
  paths[p] = {};
  for (const method of METHODS) {
    const op = pathItem[method];
    if (!op) continue;
    const product = extractProduct(p);
    const tags = op.tags ? [...op.tags] : [];
    if (product && !tags.some(t => t.toLowerCase() === product.toLowerCase())) tags.unshift(product);
    paths[p][method] = {
      summary: op.summary,
      description: op.description,
      tags,
      parameters: resolveRefs(op.parameters),
      requestBody: resolveRefs(op.requestBody),
      responses: resolveRefs(op.responses),
    };
  }
}

// Also extract sorted product list by frequency
const productCounts = new Map();
for (const p of Object.keys(paths)) {
  const product = extractProduct(p);
  if (product) productCounts.set(product, (productCounts.get(product) || 0) + 1);
}
const products = [...productCounts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);

fs.writeFileSync(OUT, JSON.stringify({ paths, products }, null, 0));
const size = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
console.log(`Written to ${OUT} (${size} MB)`);
console.log(`Top products: ${products.slice(0, 10).join(', ')}`);
