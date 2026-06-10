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
  node scrape_kuaishou_work_stats_cdp.mjs --url <kuaishou-url> [--url <kuaishou-url> ...] [--concurrency 2] [--out-dir ./work-stats]
  node scrape_kuaishou_work_stats_cdp.mjs --input urls.txt --concurrency 3 --out-dir ./work-stats

Requires a real Chrome instance started with --remote-debugging-port=9222.`;
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function findPageById(cdpBase, targetId) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const pages = await getJson(`${cdpBase}/json/list`);
    const page = pages.find((item) => item.id === targetId && item.type === 'page' && item.webSocketDebuggerUrl);
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function createPage(cdpBase) {
  try {
    const version = await getJson(`${cdpBase}/json/version`);
    if (version.webSocketDebuggerUrl) {
      const browser = await connect(version.webSocketDebuggerUrl);
      try {
        const result = await browser.send('Target.createTarget', {
          url: 'about:blank',
          background: true,
        });
        const page = await findPageById(cdpBase, result.targetId);
        if (page) return { ...page, shouldCloseTarget: true };
      } finally {
        browser.close();
      }
    }
  } catch {
    // Fall back to /json/new when browser-level background targets are unavailable.
  }
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
  const text = String(rawUrl);
  const directMatch =
    text.match(/\/short-video\/([A-Za-z0-9_-]+)/) ||
    text.match(/\/fw\/photo\/([A-Za-z0-9_-]+)/) ||
    text.match(/\/photo\/([A-Za-z0-9_-]+)/);
  const ids = new Set();
  if (directMatch) ids.add(directMatch[1]);
  try {
    const parsed = new URL(text);
    for (const key of ['photoId', 'photo_id', 'shareObjectId']) {
      const value = parsed.searchParams.get(key);
      if (value) ids.add(value);
    }
  } catch {
    for (const match of text.matchAll(/[?&](?:photoId|photo_id|shareObjectId)=([A-Za-z0-9_-]+)/g)) {
      ids.add(match[1]);
    }
  }
  if (directMatch) return { id: directMatch[1], ids: [...ids], type: 'photo' };
  const queryMatch = text.match(/[?&](?:photoId|photo_id|shareObjectId)=([A-Za-z0-9_-]+)/);
  if (queryMatch) return { id: queryMatch[1], ids: [...ids], type: 'photo' };
  return { id: null, ids: [...ids], type: null };
}

function canonicalUrl(work, fallbackUrl) {
  if (work.type === 'photo' && work.id) return `https://www.kuaishou.com/short-video/${work.id}`;
  return fallbackUrl;
}

function normalizeTarget(rawUrl) {
  const work = workFromUrl(rawUrl);
  return {
    inputUrl: rawUrl,
    photoId: work.id,
    photoIds: work.ids || [],
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
  const statistics = raw.statistics || raw.stats || raw.photo_stats || raw;
  const author = raw.author || raw.user || raw.user_info || raw.userInfo || raw.owner || {};
  const publish = normalizePublishTime(firstValue(raw, [
    'create_time',
    'createTime',
    'publish_time',
    'publishTime',
    'publish_time_raw',
    'timestamp',
    'timestampMs',
    'uploadTime',
    'time',
  ]));
  const row = {
    author_nickname: normalizeText(firstValue(author, ['nickname', 'name', 'userName', 'kwaiId']) || firstValue(raw, ['author_nickname', 'authorName', 'nickname', 'userName'])),
    work_title: normalizeText(firstValue(raw, ['caption', 'desc', 'title', 'photoCaption', 'content'])),
    like_count: normalizeCount(firstValue(statistics, ['likeCount', 'likedCount', 'realLikeCount', 'digg_count', 'like_count', 'likes'])),
    comment_count: normalizeCount(firstValue(statistics, ['commentCount', 'comment_count', 'comments'])),
    collect_count: normalizeCount(firstValue(statistics, ['collectCount', 'collectionCount', 'collect_count', 'collection_count', 'favorite_count', 'favourite_count'])),
    share_count: normalizeCount(firstValue(statistics, ['shareCount', 'forwardCount', 'share_count', 'shares'])),
    publish_time: publish.formatted,
    publish_timestamp: publish.timestamp,
    publish_time_raw: publish.raw,
    source,
  };
  const hasAny = ['author_nickname', 'work_title', 'like_count', 'comment_count', 'collect_count', 'share_count', 'publish_time', 'publish_timestamp', 'publish_time_raw']
    .some((key) => row[key] != null);
  return hasAny ? row : null;
}

function extractCandidateIds(value) {
  const ids = new Set();
  if (!value || typeof value !== 'object') return [];
  for (const key of ['photo_id', 'photoId', 'photoIdStr', 'photo_id_str', 'item_id', 'itemId', 'id']) {
    if (value[key] != null && typeof value[key] !== 'object') ids.add(String(value[key]));
  }
  for (const key of ['share_info', 'shareInfo']) {
    const shareInfo = value[key];
    if (typeof shareInfo === 'string') {
      try {
        const params = new URLSearchParams(shareInfo);
        for (const idKey of ['photoId', 'photo_id', 'shareObjectId']) {
          const id = params.get(idKey);
          if (id) ids.add(id);
        }
      } catch {
        const match = shareInfo.match(/(?:^|&)(?:photoId|photo_id|shareObjectId)=([^&]+)/);
        if (match) ids.add(decodeURIComponent(match[1]));
      }
    } else if (shareInfo && typeof shareInfo === 'object') {
      for (const idKey of ['photoId', 'photo_id', 'shareObjectId']) {
        if (shareInfo[idKey] != null) ids.add(String(shareInfo[idKey]));
      }
    }
  }
  return [...ids];
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

function collectWorkStats(value, contextIds = [], out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectWorkStats(item, contextIds, out);
    return out;
  }

  const candidateIds = [...new Set([...extractCandidateIds(value), ...contextIds.map(String)])];
  const looksLikeWork =
    value.statistics ||
    value.stats ||
    value.photo_stats ||
    value.photo_id ||
    value.photoId ||
    value.userName ||
    value.caption ||
    value.likeCount ||
    value.commentCount ||
    value.create_time ||
    value.createTime ||
    value.timestamp ||
    value.publish_time ||
    value.publishTime;
  if (looksLikeWork) {
    const stats = normalizeWorkStats(value, 'api');
    if (stats) out.push({ ...stats, candidate_photo_ids: candidateIds });
  }

  for (const key of ['photo', 'photos', 'photoList', 'feeds', 'items', 'list', 'data', 'visionVideoDetail', 'photoResult']) {
    if (value[key]) collectWorkStats(value[key], contextIds, out);
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
      const readByAction = (tokens) => {
        const items = [...document.querySelectorAll('[data-log-action], .action-item')];
        for (const item of items) {
          const action = item.getAttribute('data-log-action') || '';
          const className = item.className || '';
          const marker = (action + ' ' + className).toUpperCase();
          if (!tokens.some((token) => marker.includes(token))) continue;
          const directText = [...item.children].find((child) => child.classList?.contains('text'));
          const text = directText?.textContent || item.textContent || '';
          const count = normalizeCount(text);
          if (count != null) return count;
        }
        return null;
      };
      const readTextByAction = (tokens) => {
        const items = [...document.querySelectorAll('[data-log-action]')];
        for (const item of items) {
          const action = (item.getAttribute('data-log-action') || '').toUpperCase();
          if (!tokens.some((token) => action.includes(token))) continue;
          const text = (item.textContent || '').trim();
          if (text) return text;
        }
        return null;
      };
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
      const author = readTextByAction(['AUTHOR_NICKNAME']);
      return {
        author_nickname: author ? author.replace(/^@/, '') : null,
        work_title: readTextByAction(['PHOTO_DESCRIPTION']),
        like_count: readByAction(['LIKE']) ?? readByLabel(['点赞', '喜欢']),
        comment_count: readByAction(['COMMENT']) ?? readByLabel(['评论']),
        collect_count: readByAction(['COLLECT', 'FAVORITE']) ?? readByLabel(['收藏']),
        share_count: readByAction(['SHARE', 'FORWARD']),
        publish_time_raw: publishMatch?.[1] || null,
        source: 'dom',
      };
    })()
  `;
}

function apolloStatsExpression() {
  return `
    (() => {
      const state = window.__APOLLO_STATE__?.defaultClient || window.__APOLLO_STATE__ || {};
      const entries = Object.entries(state);
      const detailEntry = entries.find(([key]) => key.includes('visionVideoDetail'));
      const detail = detailEntry?.[1] || {};
      const photoRef = detail.photo?.id;
      const authorRef = detail.author?.id;
      const photo = (photoRef && state[photoRef]) || entries.find(([key]) => key.startsWith('VisionVideoDetailPhoto:'))?.[1] || {};
      const author = (authorRef && state[authorRef]) || entries.find(([key]) => key.startsWith('VisionVideoDetailAuthor:'))?.[1] || {};
      const commentLimit = detail.commentLimit?.id ? state[detail.commentLimit.id] : detail.commentLimit;
      return {
        photoId: photo.id || null,
        author: { name: author.name || author.userName || author.nickname || null },
        caption: photo.caption || null,
        likeCount: photo.realLikeCount ?? photo.likeCount ?? null,
        commentCount: commentLimit?.count ?? commentLimit?.commentCount ?? photo.commentCount ?? null,
        shareCount: photo.shareCount ?? photo.forwardCount ?? null,
        timestamp: photo.timestamp ?? null,
        source: 'apollo',
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

async function emulateIPhone(cdp) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844,
    positionX: 0,
    positionY: 0,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 5,
  });
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
  });
}

async function createScrapeSession(options) {
  const page = await createPage(options.cdpBase);
  const cdp = await connect(page.webSocketDebuggerUrl);
  await emulateIPhone(cdp);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable', { maxResourceBufferSize: 10000000, maxTotalBufferSize: 50000000 });
  return { page, cdp };
}

async function writeSummaryCsv(outDir, rows) {
  await fs.mkdir(outDir, { recursive: true });
  const csvPath = path.join(outDir, 'kuaishou_work_stats_summary.csv');
  const columns = [
    ['达人昵称', 'author_nickname'],
    ['photoId', 'photoId'],
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
  const effectivePhotoIds = new Set([target.photoId, ...(target.photoIds || [])].filter(Boolean).map(String));
  let effectivePhotoId = target.photoId;
  let stats = null;
  let offResponseReceived = null;
  let offLoadingFinished = null;

  const addEffectiveIds = (work) => {
    if (work?.id) {
      effectivePhotoId = work.id;
      effectivePhotoIds.add(String(work.id));
    }
    for (const id of work?.ids || []) effectivePhotoIds.add(String(id));
  };

  const rebuildStats = () => {
    stats = null;
    for (const candidate of statsCandidates) {
      const candidateIds = candidate.candidate_photo_ids || (candidate.candidate_photo_id ? [candidate.candidate_photo_id] : []);
      const matches = effectivePhotoIds.size
        ? candidateIds.some((candidateId) => effectivePhotoIds.has(String(candidateId)))
        : !candidateIds.length;
      if (matches) stats = mergeWorkStats(stats, candidate);
    }
  };

  try {
    offResponseReceived = cdp.on('Network.responseReceived', (params) => {
      const url = params.response?.url || '';
      if (/kuaishou\.com|chenzhongtech\.com|gifshow\.com/.test(url)) {
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
        const responseWork = workFromUrl(url);
        statsCandidates.push(...collectWorkStats(parsed, responseWork.ids || []));
        rebuildStats();
        if (stats) console.log(`[${target.photoId || target.url}] stats from ${new URL(url).pathname}`);
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
      if (currentWork.id || currentWork.ids?.length) {
        addEffectiveIds(currentWork);
        rebuildStats();
      }
      if (stats?.like_count != null && stats?.comment_count != null && (stats?.publish_time || stats?.publish_time_raw)) {
        break;
      }
    }

    const finalState = await cdp.send('Runtime.evaluate', {
      expression: '({ href: location.href, title: document.title })',
      returnByValue: true,
    }).then((result) => result.result?.value || {}).catch(() => ({}));
    const apolloRaw = await cdp.send('Runtime.evaluate', {
      expression: apolloStatsExpression(),
      returnByValue: true,
    }).then((result) => result.result?.value || {}).catch(() => ({}));
    const apolloStats = normalizeWorkStats(apolloRaw, 'apollo');
    if (apolloRaw.photoId && apolloStats) statsCandidates.push({ ...apolloStats, candidate_photo_ids: [String(apolloRaw.photoId)] });
    rebuildStats();

    const finalUrl = finalState.href || target.url;
    const finalWork = workFromUrl(finalUrl);
    const finalId = finalWork.id || target.photoId;
    addEffectiveIds(finalWork);
    rebuildStats();
    const domStats = await cdp.send('Runtime.evaluate', {
      expression: domStatsExpression(),
      returnByValue: true,
    }).then((result) => result.result?.value || null).catch(() => null);
    stats = stats || {};
    stats = mergeWorkStats(stats, domStats);
    const publish = normalizePublishTime(stats.publish_time || stats.publish_time_raw);
    if (!stats.publish_time && publish.formatted) stats.publish_time = publish.formatted;
    if (!stats.publish_timestamp && publish.timestamp) stats.publish_timestamp = publish.timestamp;

    const finalType = finalWork.type || target.itemType;
    const finalTarget = {
      ...target,
      photoId: finalId,
      itemType: finalType,
      url: canonicalUrl({ id: finalId, type: finalType }, finalUrl),
    };
    const payload = {
      inputUrl: finalTarget.inputUrl,
      targetUrl: finalTarget.url,
      photoId: finalTarget.photoId,
      itemType: finalTarget.itemType,
      author_nickname: stats.author_nickname || null,
      title: stats.work_title || (finalState.title && finalState.title !== '快手' ? finalState.title : null),
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
  if (!urls.length) throw new Error(`No Kuaishou URLs provided.\n${usage()}`);
  if (!Number.isFinite(options.concurrency) || options.concurrency < 1) {
    throw new Error('--concurrency must be a positive number');
  }
  options.concurrency = Math.max(1, Math.floor(options.concurrency));

  await getJson(`${options.cdpBase}/json/version`).catch((error) => {
    throw new Error(`Cannot connect to Chrome CDP at ${options.cdpBase}. Run scripts/ensure_chrome_cdp.mjs first to start the persistent Kuaishou CDP Chrome profile. ${error.message}`);
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
