import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) {
  delete process.env[key];
}
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost']
  .filter(Boolean)
  .join(',');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaults = {
  cdpBase: process.env.CDP_BASE || 'http://127.0.0.1:9222',
  maxComments: Number(process.env.MAX_COMMENTS || 1000),
  maxIdleMs: Number(process.env.MAX_IDLE_MS || 15000),
  maxRunMs: Number(process.env.MAX_RUN_MS || 180000),
  concurrency: Number(process.env.CONCURRENCY || 1),
  outDir: process.cwd(),
};

function usage() {
  return `Usage:
  node scrape_platform_comments_cdp.mjs --url <douyin-or-kuaishou-url> [--url <url> ...] [--max 1000] [--concurrency 2] [--out-dir ./comments]
  node scrape_platform_comments_cdp.mjs --input urls.txt --max 500 --concurrency 3 --out-dir ./comments`;
}

function parseArgs(argv) {
  const options = { urls: [], ...defaults };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url') options.urls.push(argv[++i]);
    else if (arg === '--input') options.input = argv[++i];
    else if (arg === '--max') options.maxComments = Number(argv[++i]);
    else if (arg === '--out-dir') options.outDir = argv[++i];
    else if (arg === '--cdp-base') options.cdpBase = argv[++i];
    else if (arg === '--max-idle-ms') options.maxIdleMs = Number(argv[++i]);
    else if (arg === '--max-run-ms') options.maxRunMs = Number(argv[++i]);
    else if (arg === '--concurrency') options.concurrency = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (!arg.startsWith('--')) options.urls.push(arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function detectPlatform(url) {
  const text = String(url).toLowerCase();
  if (text.includes('douyin.com') || text.includes('iesdouyin.com') || text.includes('amemv.com')) return 'douyin';
  if (text.includes('kuaishou.com') || text.includes('chenzhongtech.com') || text.includes('gifshow.com')) return 'kuaishou';
  return null;
}

async function loadUrls(options) {
  const urls = [...options.urls];
  if (options.input) {
    const text = await fs.readFile(options.input, 'utf8');
    urls.push(...text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  }
  return urls;
}

function runNode(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: 'inherit',
      env: { ...process.env, HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '' },
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(script)} exited with code ${code}`));
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const urls = await loadUrls(options);
  if (!urls.length) throw new Error(`No URLs provided.\n${usage()}`);

  const groups = { douyin: [], kuaishou: [] };
  for (const url of urls) {
    const platform = detectPlatform(url);
    if (!platform) throw new Error(`Cannot detect platform for URL: ${url}`);
    groups[platform].push(url);
  }

  await fs.mkdir(options.outDir, { recursive: true });
  for (const [platform, platformUrls] of Object.entries(groups)) {
    if (!platformUrls.length) continue;
    const script = path.join(scriptDir, platform === 'douyin' ? 'scrape_douyin_comments_cdp.mjs' : 'scrape_kuaishou_comments_cdp.mjs');
    const args = [
      ...platformUrls.flatMap((url) => ['--url', url]),
      '--max', String(options.maxComments),
      '--concurrency', String(options.concurrency),
      '--max-idle-ms', String(options.maxIdleMs),
      '--max-run-ms', String(options.maxRunMs),
      '--cdp-base', options.cdpBase,
      '--out-dir', options.outDir,
    ];
    await runNode(script, args);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
