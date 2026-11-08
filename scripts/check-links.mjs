#!/usr/bin/env node
// 校验 data.json 里所有站点可解析可访问；顺带查重。
// 用法：node nav-site/scripts/check-links.mjs [--concurrency 8]
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.resolve(here, '../public/data.json');
const concArg = process.argv.indexOf('--concurrency');
const CONC = concArg > -1 ? Number(process.argv[concArg + 1]) || 8 : 8;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// 202/401 是反爬挑战页，403/405/429 是 WAF 限流，域名本身可用
const OK = new Set([200, 201, 202, 203, 204, 301, 302, 303, 307, 308, 401, 403, 405, 429]);

const data = JSON.parse(await readFile(dataPath, 'utf8'));
const sites = [];
const seenName = new Map();
for (const c of data.categories) {
  for (const s of c.subs) {
    for (const x of s.sites) {
      sites.push({ ...x, cat: c.name, sub: s.name });
      if (seenName.has(x.n)) console.warn(`DUP  ${x.n}: ${seenName.get(x.n)} / ${c.name}/${s.name}`);
      else seenName.set(x.n, `${c.name}/${s.name}`);
    }
  }
}

async function probe(site) {
  const opts = {
    method: 'GET',
    redirect: 'follow',
    headers: { 'user-agent': UA, accept: 'text/html,*/*' },
    signal: AbortSignal.timeout(15000),
  };
  try {
    let res = await fetch(site.u, opts);
    if (res.status >= 500) res = await fetch(site.u, { ...opts, method: 'HEAD' });
    return { ...site, status: res.status, ok: OK.has(res.status) };
  } catch (e) {
    // 部分站点拒绝 HEAD / 需要 TLS 重试，GET 已失败就直接记为不可达
    return { ...site, status: 0, ok: false, err: e.cause?.code || e.name };
  }
}

const results = [];
let i = 0;
await Promise.all(
  Array.from({ length: CONC }, async () => {
    while (i < sites.length) {
      const idx = i++;
      results[idx] = await probe(sites[idx]);
    }
  })
);

const bad = results.filter((r) => !r.ok);
console.log(`\n${sites.length} sites · ${sites.length - bad.length} ok · ${bad.length} bad · ${data.categories.length} categories`);
for (const b of bad) console.log(`BAD  ${String(b.status).padEnd(4)} ${b.n.padEnd(18)} ${b.u}${b.err ? '  ' + b.err : ''}`);
process.exit(bad.length ? 1 : 0);
