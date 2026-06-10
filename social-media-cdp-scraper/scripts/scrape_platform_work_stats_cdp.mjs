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
  maxRunMs: Number(process.env.MAX_RUN_MS || 20000),
  concurrency: Number(process.env.CONCURRENCY || 1),
  outDir: process.cwd(),
};

function usage() {
  return `Usage:
  node scrape_platform_work_stats_cdp.mjs --url <douyin-or-kuaishou-url> [--url <url> ...] [--concurrency 2] [--out-dir ./work-stats]
  node scrape_platform_work_stats_cdp.mjs --input urls.txt --concurrency 3 --out-dir ./work-stats`;
}

function parseArgs(argv) {
  const options = { urls: [], ...defaults };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url') options.urls.push(argv[++i]);
    else if (arg === '--input') options.input = argv[++i];
    else if (arg === '--out-dir') options.outDir = argv[++i];
    else if (arg === '--cdp-base') options.cdpBase = argv[++i];
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

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

async function readPlatformRows(platform, csvPath) {
  const text = await fs.readFile(csvPath, 'utf8').catch(() => '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const idHeader = platform === 'douyin' ? 'awemeId' : 'photoId';
  return lines.slice(1).map((line) => {
    const row = Object.fromEntries(parseCsvLine(line).map((value, index) => [headers[index], value]));
    return {
      platform: platform === 'douyin' ? '抖音' : '快手',
      author: row['达人昵称'],
      id: row[idHeader],
      url: row['作品链接'],
      title: row['作品标题'],
      publishTime: row['发布时间'],
      likeCount: row['点赞'],
      commentCount: row['评论'],
      collectCount: row['收藏'],
      shareCount: row['转发'],
    };
  });
}

async function writeCombinedCsv(outDir, rows) {
  await fs.mkdir(outDir, { recursive: true });
  const csvPath = path.join(outDir, 'work_stats_summary.csv');
  const columns = [
    ['平台', 'platform'],
    ['达人昵称', 'author'],
    ['作品ID', 'id'],
    ['作品链接', 'url'],
    ['作品标题', 'title'],
    ['发布时间', 'publishTime'],
    ['点赞', 'likeCount'],
    ['评论', 'commentCount'],
    ['收藏', 'collectCount'],
    ['转发', 'shareCount'],
  ];
  const lines = [
    columns.map(([label]) => label).join(','),
    ...rows.map((row) => columns.map(([, key]) => csvEscape(row[key])).join(',')),
  ];
  await fs.writeFile(csvPath, `${lines.join('\n')}\n`);
  return csvPath;
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

  const outputs = [];
  for (const [platform, platformUrls] of Object.entries(groups)) {
    if (!platformUrls.length) continue;
    const platformOutDir = path.join(options.outDir, platform);
    const script = path.join(scriptDir, platform === 'douyin' ? 'scrape_douyin_work_stats_cdp.mjs' : 'scrape_kuaishou_work_stats_cdp.mjs');
    const args = [
      ...platformUrls.flatMap((url) => ['--url', url]),
      '--concurrency', String(options.concurrency),
      '--max-run-ms', String(options.maxRunMs),
      '--cdp-base', options.cdpBase,
      '--out-dir', platformOutDir,
    ];
    await runNode(script, args);
    outputs.push({
      platform,
      csvPath: path.join(platformOutDir, platform === 'douyin' ? 'douyin_work_stats_summary.csv' : 'kuaishou_work_stats_summary.csv'),
    });
  }

  const rows = [];
  for (const output of outputs) rows.push(...await readPlatformRows(output.platform, output.csvPath));
  const combined = await writeCombinedCsv(options.outDir, rows);
  console.log(`Wrote ${rows.length} rows to ${combined}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
