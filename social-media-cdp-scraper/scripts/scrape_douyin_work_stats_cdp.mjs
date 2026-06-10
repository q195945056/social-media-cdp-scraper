import fs from 'node:fs/promises';
import path from 'node:path';

for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) {
  delete process.env[key];
}
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost']
  .filter(Boolean)
  .join(',');

const defaults = {
  cdpBase: process.env.CDP_BASE || 'http://127.0.0.1:9222',
  maxRunMs: Number(process.env.MAX_RUN_MS || 20000),
  concurrency: Number(process.env.CONCURRENCY || 1),
  outDir: process.cwd(),
};

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

function usage() {
  return `Usage:
  node scrape_douyin_work_stats_cdp.mjs --url <douyin-url> [--url <douyin-url> ...] [--concurrency 2] [--out-dir ./work-stats]
  node scrape_douyin_work_stats_cdp.mjs --input urls.txt --concurrency 3 --out-dir ./work-stats

Requires a real Chrome instance started with --remote-debugging-port=9222.`;
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function createPage(cdpBase) {
  try {
    const response = await fetch(`${cdpBase}/json/new?about:blank`, { method: 'PUT' });
    if (response.ok) return { ...await response.json(), shouldCloseTarget: true };
  } catch {
    // Reuse an existing page if Chrome does not allow creating a new one.
  }
  const pages = await getJson(`${cdpBase}/json/list`);
  const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
  if (!page) throw new Error('No CDP page target available');
  return { ...page, shouldCloseTarget: false };
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = new Map();

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result || {});
      return;
    }
    if (message.method && listeners.has(message.method)) {
      for (const listener of listeners.get(message.method)) listener(message.params || {});
    }
  });

  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const messageId = ++id;
          ws.send(JSON.stringify({ id: messageId, method, params }));
          return new Promise((resolveSend, rejectSend) => {
            pending.set(messageId, { resolve: resolveSend, reject: rejectSend });
            setTimeout(() => {
              if (pending.delete(messageId)) rejectSend(new Error(`CDP timeout: ${method}`));
            }, 20000).unref();
          });
        },
        on(method, listener) {
          if (!listeners.has(method)) listeners.set(method, new Set());
          const methodListeners = listeners.get(method);
          methodListeners.add(listener);
          return () => {
            methodListeners.delete(listener);
            if (!methodListeners.size) listeners.delete(method);
          };
        },
        close() {
          ws.close();
        },
      });
    });
    ws.addEventListener('error', reject);
  });
}

function workFromUrl(rawUrl) {
  const videoMatch = rawUrl.match(/\/video\/(\d+)/) || rawUrl.match(/[?&]modal_id=(\d+)/);
  if (videoMatch) return { id: videoMatch[1], type: 'video' };
  const noteMatch = rawUrl.match(/\/note\/(\d+)/);
  if (noteMatch) return { id: noteMatch[1], type: 'note' };
  return { id: null, type: null };
}

function canonicalUrl(work, fallbackUrl) {
  if (work.type === 'video' && work.id) return `https://www.douyin.com/video/${work.id}`;
  if (work.type === 'note' && work.id) return `https://www.douyin.com/note/${work.id}`;
  return fallbackUrl;
}

function normalizeTarget(rawUrl) {
  const work = workFromUrl(rawUrl);
  return {
    inputUrl: rawUrl,
    awemeId: work.id,
    itemType: work.type,
    url: canonicalUrl(work, rawUrl),
  };
}

function normalizeCount(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).replace(/,/g, '').trim();
  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  if (text.includes('亿')) return Math.round(number * 100000000);
  if (text.includes('万') || /w/i.test(text)) return Math.round(number * 10000);
  return Math.round(number);
}

function formatBeijingTime(timestamp) {
  if (!Number.isFinite(timestamp)) return null;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(timestamp * 1000));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}:${byType.second}`;
}

function normalizePublishTime(value) {
  if (value == null || value === '') return { timestamp: null, formatted: null, raw: null };
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const raw = Number(value);
    if (!Number.isFinite(raw) || raw <= 0) return { timestamp: null, formatted: null, raw: value };
    const timestamp = raw > 100000000000 ? Math.round(raw / 1000) : raw;
    return { timestamp, formatted: formatBeijingTime(timestamp), raw: value };
  }
  const text = String(value).trim();
  const normalized = text
    .replace(/年|\/|\./g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '');
  const parsed = Date.parse(normalized);
  if (Number.isFinite(parsed)) {
    const timestamp = Math.round(parsed / 1000);
    return { timestamp, formatted: formatBeijingTime(timestamp), raw: value };
  }
  return { timestamp: null, formatted: null, raw: value };
}

function firstValue(raw, keys) {
  if (!raw || typeof raw !== 'object') return null;
  for (const key of keys) {
    if (raw[key] != null) return raw[key];
  }
  return null;
}

function normalizeText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeWorkStats(raw, source = 'api') {
  if (!raw || typeof raw !== 'object') return null;
  const statistics = raw.statistics || raw.stats || raw.video_stats || raw;
  const author = raw.author || raw.user || raw.user_info || {};
  const publish = normalizePublishTime(firstValue(raw, ['create_time', 'createTime', 'publish_time', 'publishTime', 'publish_time_raw']));
  const row = {
    author_nickname: normalizeText(firstValue(author, ['nickname', 'name', 'unique_id', 'short_id']) || firstValue(raw, ['author_nickname', 'authorName', 'nickname'])),
    work_title: normalizeText(firstValue(raw, ['desc', 'title', 'aweme_title', 'item_title', 'content'])),
    like_count: normalizeCount(firstValue(statistics, ['digg_count', 'like_count', 'liked_count', 'likes'])),
    comment_count: normalizeCount(firstValue(statistics, ['comment_count', 'commentCount', 'comments'])),
    collect_count: normalizeCount(firstValue(statistics, ['collect_count', 'collection_count', 'favorite_count', 'favourite_count'])),
    share_count: normalizeCount(firstValue(statistics, ['share_count', 'shareCount', 'shares'])),
    publish_time: publish.formatted,
    publish_timestamp: publish.timestamp,
    publish_time_raw: publish.raw,
    source,
  };
  const hasAny = ['author_nickname', 'work_title', 'like_count', 'comment_count', 'collect_count', 'share_count', 'publish_time', 'publish_timestamp', 'publish_time_raw']
    .some((key) => row[key] != null);
  return hasAny ? row : null;
}

function mergeWorkStats(current, next) {
  if (!next) return current;
  if (!current) return next;
  const merged = { ...current };
  for (const [key, value] of Object.entries(next)) {
    if (key === 'source') continue;
    if (merged[key] == null && value != null) merged[key] = value;
  }
  if (merged.source !== 'api' && next.source === 'api') merged.source = 'api';
  return merged;
}

function collectWorkStats(value, targetId, out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectWorkStats(item, targetId, out);
    return out;
  }

  const rawId = value.aweme_id || value.awemeId || value.item_id || value.itemId || value.id;
  const idMatches = !targetId || !rawId || String(rawId) === String(targetId);
  const looksLikeWork =
    value.statistics ||
    value.stats ||
    value.video_stats ||
    value.aweme_id ||
    value.awemeId ||
    value.create_time ||
    value.createTime ||
    value.publish_time ||
    value.publishTime;
  if (idMatches && looksLikeWork) {
    const stats = normalizeWorkStats(value, 'api');
    if (stats) out.push({ ...stats, candidate_aweme_id: rawId ? String(rawId) : null });
  }

  for (const key of ['aweme_detail', 'aweme_details', 'aweme_list', 'item_list', 'items', 'data']) {
    if (value[key]) collectWorkStats(value[key], targetId, out);
  }
  return out;
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function domStatsExpression() {
  return `
    (() => {
      const normalizeCount = (value) => {
        if (value == null) return null;
        const text = String(value).replace(/,/g, '').trim();
        const match = text.match(/(\\d+(?:\\.\\d+)?)/);
        if (!match) return null;
        const number = Number(match[1]);
        if (!Number.isFinite(number)) return null;
        if (text.includes('亿')) return Math.round(number * 100000000);
        if (text.includes('万') || /w/i.test(text)) return Math.round(number * 10000);
        return Math.round(number);
      };
      const bodyText = document.body.innerText || '';
      const readByLabel = (labels) => {
        for (const label of labels) {
          const patterns = [
            new RegExp(label + '[：:\\\\s]*(\\\\d+(?:\\\\.\\\\d+)?(?:万|亿|w)?)', 'i'),
            new RegExp('(\\\\d+(?:\\\\.\\\\d+)?(?:万|亿|w)?)\\\\s*' + label, 'i'),
          ];
          for (const pattern of patterns) {
            const match = bodyText.match(pattern);
            const count = normalizeCount(match?.[1]);
            if (count != null) return count;
          }
        }
        return null;
      };
      const publishMatch = bodyText.match(/(\\d{4}[-/.年]\\d{1,2}[-/.月]\\d{1,2}日?(?:\\s+\\d{1,2}:\\d{2})?)/);
      return {
        like_count: readByLabel(['点赞', '喜欢']),
        comment_count: readByLabel(['评论']),
        collect_count: readByLabel(['收藏']),
        share_count: readByLabel(['分享', '转发']),
        publish_time_raw: publishMatch?.[1] || null,
        source: 'dom',
      };
    })()
  `;
}

async function closePage(cdp, page) {
  if (page.shouldCloseTarget && page.id) {
    await cdp.send('Target.closeTarget', { targetId: page.id }).catch(() => {});
  }
  cdp.close();
}

async function createScrapeSession(options) {
  const page = await createPage(options.cdpBase);
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable', { maxResourceBufferSize: 10000000, maxTotalBufferSize: 50000000 });
  return { page, cdp };
}

async function writeSummaryCsv(outDir, rows) {
  await fs.mkdir(outDir, { recursive: true });
  const csvPath = path.join(outDir, 'douyin_work_stats_summary.csv');
  const columns = [
    ['达人昵称', 'author_nickname'],
    ['awemeId', 'awemeId'],
    ['作品链接', 'targetUrl'],
    ['作品标题', 'title'],
    ['发布时间', 'publish_time'],
    ['点赞', 'like_count'],
    ['评论', 'comment_count'],
    ['收藏', 'collect_count'],
    ['转发', 'share_count'],
  ];
  const lines = [
    columns.map(([label]) => label).join(','),
    ...rows.map((row) => columns.map(([, key]) => csvEscape(row[key])).join(',')),
  ];
  await fs.writeFile(csvPath, `${lines.join('\n')}\n`);
  return csvPath;
}

async function scrapeOne(target, options, session) {
  const { cdp } = session;
  const responseUrls = new Map();
  const statsCandidates = [];
  let effectiveAwemeId = target.awemeId;
  let stats = null;
  let offResponseReceived = null;
  let offLoadingFinished = null;

  const rebuildStats = () => {
    stats = null;
    for (const candidate of statsCandidates) {
      const candidateId = candidate.candidate_aweme_id;
      const matches = effectiveAwemeId
        ? (!candidateId || String(candidateId) === String(effectiveAwemeId))
        : !candidateId;
      if (matches) stats = mergeWorkStats(stats, candidate);
    }
  };

  try {
    offResponseReceived = cdp.on('Network.responseReceived', (params) => {
      const url = params.response?.url || '';
      if (/douyin\.com|amemv\.com|snssdk\.com/.test(url)) {
        responseUrls.set(params.requestId, url);
      }
    });

    offLoadingFinished = cdp.on('Network.loadingFinished', async (params) => {
      const url = responseUrls.get(params.requestId);
      if (!url) return;
      responseUrls.delete(params.requestId);
      try {
        const body = await cdp.send('Network.getResponseBody', { requestId: params.requestId });
        const parsed = JSON.parse(body.body);
        statsCandidates.push(...collectWorkStats(parsed, effectiveAwemeId));
        rebuildStats();
        if (stats) console.log(`[${target.awemeId || target.url}] stats from ${new URL(url).pathname}`);
      } catch {
        // Some responses are not JSON, encoded, cached, or already evicted from CDP.
      }
    });

    await cdp.send('Page.navigate', { url: target.url });

    const startedAt = Date.now();
    while (Date.now() - startedAt < options.maxRunMs) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await cdp.send('Runtime.evaluate', {
        expression: 'window.scrollBy(0, Math.max(300, innerHeight * 0.35))',
      }).catch(() => {});
      const href = await cdp.send('Runtime.evaluate', {
        expression: 'location.href',
        returnByValue: true,
      }).then((result) => result.result?.value).catch(() => null);
      const currentWork = href ? workFromUrl(href) : { id: null };
      if (currentWork.id && currentWork.id !== effectiveAwemeId) {
        effectiveAwemeId = currentWork.id;
        rebuildStats();
      }
      if (stats?.like_count != null && stats?.comment_count != null && stats?.collect_count != null && stats?.share_count != null && (stats?.publish_time || stats?.publish_time_raw)) {
        break;
      }
    }

    const finalState = await cdp.send('Runtime.evaluate', {
      expression: '({ href: location.href, title: document.title })',
      returnByValue: true,
    }).then((result) => result.result?.value || {}).catch(() => ({}));
    const domStats = await cdp.send('Runtime.evaluate', {
      expression: domStatsExpression(),
      returnByValue: true,
    }).then((result) => normalizeWorkStats(result.result?.value || {}, 'dom')).catch(() => null);
    stats = mergeWorkStats(stats, domStats) || {};

    const publish = normalizePublishTime(stats.publish_time || stats.publish_time_raw);
    if (!stats.publish_time && publish.formatted) stats.publish_time = publish.formatted;
    if (!stats.publish_timestamp && publish.timestamp) stats.publish_timestamp = publish.timestamp;

    const finalUrl = finalState.href || target.url;
    const finalWork = workFromUrl(finalUrl);
    const finalId = finalWork.id || target.awemeId;
    if (finalId && finalId !== effectiveAwemeId) {
      effectiveAwemeId = finalId;
      rebuildStats();
    }
    const finalType = finalWork.type || target.itemType;
    const finalTarget = {
      ...target,
      awemeId: finalId,
      itemType: finalType,
      url: canonicalUrl({ id: finalId, type: finalType }, finalUrl),
    };
    const payload = {
      inputUrl: finalTarget.inputUrl,
      targetUrl: finalTarget.url,
      awemeId: finalTarget.awemeId,
      itemType: finalTarget.itemType,
      author_nickname: stats.author_nickname || null,
      title: stats.work_title || finalState.title || null,
      scrapedAt: new Date().toISOString(),
      ...stats,
      stats,
    };
    return payload;
  } catch (error) {
    throw error;
  } finally {
    offResponseReceived?.();
    offLoadingFinished?.();
    responseUrls.clear();
  }
}

async function loadUrls(options) {
  const urls = [...options.urls];
  if (options.input) {
    const text = await fs.readFile(options.input, 'utf8');
    urls.push(...text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  }
  return urls;
}

async function scrapeWithConcurrency(targets, options) {
  const results = new Array(targets.length);
  let nextIndex = 0;
  const workerCount = Math.min(options.concurrency, targets.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    const session = await createScrapeSession(options);
    try {
      while (nextIndex < targets.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await scrapeOne(targets[index], options, session);
      }
    } finally {
      await closePage(session.cdp, session.page);
    }
  }));
  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const urls = await loadUrls(options);
  if (!urls.length) throw new Error(`No Douyin URLs provided.\n${usage()}`);
  if (!Number.isFinite(options.concurrency) || options.concurrency < 1) {
    throw new Error('--concurrency must be a positive number');
  }
  options.concurrency = Math.max(1, Math.floor(options.concurrency));

  await getJson(`${options.cdpBase}/json/version`).catch((error) => {
    throw new Error(`Cannot connect to Chrome CDP at ${options.cdpBase}. Run scripts/ensure_chrome_cdp.mjs first to start the persistent Douyin CDP Chrome profile. ${error.message}`);
  });

  const targets = urls.map(normalizeTarget);
  const results = await scrapeWithConcurrency(targets, options);
  const csvPath = await writeSummaryCsv(options.outDir, results);
  console.log(`Wrote ${results.length} rows to ${csvPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
