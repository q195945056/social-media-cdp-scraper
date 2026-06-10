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
  maxComments: Number(process.env.MAX_COMMENTS || 1000),
  maxIdleMs: Number(process.env.MAX_IDLE_MS || 15000),
  maxRunMs: Number(process.env.MAX_RUN_MS || 180000),
  concurrency: Number(process.env.CONCURRENCY || 1),
  outDir: process.cwd(),
};

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

function usage() {
  return `Usage:
  node scrape_douyin_comments_cdp.mjs --url <douyin-url> [--url <douyin-url> ...] [--max 1000] [--concurrency 2] [--out-dir ./comments]
  node scrape_douyin_comments_cdp.mjs --input urls.txt --max 500 --concurrency 3 --out-dir ./comments

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
    if (response.ok) return response.json();
  } catch {
    // Reuse an existing page if Chrome does not allow creating a new one.
  }
  const pages = await getJson(`${cdpBase}/json/list`);
  const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
  if (!page) throw new Error('No CDP page target available');
  return page;
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
          listeners.get(method).add(listener);
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

function normalizeComment(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const user = raw.user || raw.author || {};
  const text = raw.text || raw.content || raw.comment_text || '';
  const cid = raw.cid || raw.comment_id || raw.id || `${user.uid || user.sec_uid || ''}:${text}`;
  if (!text || !cid) return null;
  return {
    cid: String(cid),
    text: String(text).replace(/\s+/g, ' ').trim(),
    create_time: raw.create_time || raw.createTime || null,
    digg_count: raw.digg_count ?? raw.like_count ?? null,
    reply_comment_total: raw.reply_comment_total ?? raw.reply_count ?? null,
    user_nickname: raw.user_nickname || user.nickname || user.name || '',
    user_uid: raw.user_uid || user.uid || '',
    user_sec_uid: raw.user_sec_uid || user.sec_uid || '',
  };
}

function collectComments(value, out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectComments(item, out);
    return out;
  }
  const direct = normalizeComment(value);
  if (direct) out.push(direct);
  for (const key of ['comments', 'reply_comments', 'comment_list', 'data']) {
    if (value[key]) collectComments(value[key], out);
  }
  return out;
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function outputBase(target) {
  return target.awemeId ? `douyin_comments_${target.awemeId}` : `douyin_comments_${Date.now()}`;
}

async function writeOutputs(outDir, base, payload) {
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${base}.json`);
  const csvPath = path.join(outDir, `${base}.csv`);
  await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2));

  const columns = ['cid', 'text', 'create_time', 'digg_count', 'reply_comment_total', 'user_nickname', 'user_uid', 'user_sec_uid'];
  const rows = payload.comments.map((row) => columns.map((key) => csvEscape(row[key])).join(','));
  await fs.writeFile(csvPath, [columns.join(','), ...rows].join('\n'));
  return { jsonPath, csvPath };
}

function domCommentExtractionExpression() {
  return `
    (() => Array.from(document.querySelectorAll('[data-e2e="comment-item"]')).map((el, index) => {
      const tooltip = el.querySelector('[id^="tooltip_"]')?.id || '';
      const userLink = el.querySelector('a[href*="/user/"]');
      const textNode = el.querySelector('.Sbe6bqNb');
      const imageAlts = Array.from(textNode?.querySelectorAll('img[alt]') || [])
        .map((img) => img.getAttribute('alt'))
        .filter(Boolean);
      const text = [textNode?.innerText || '', ...imageAlts].join('').trim();
      const stats = el.querySelector('.comment-item-stats-container')?.innerText || '';
      const diggMatch = stats.match(/^(\\d+|\\d+\\.\\d+万)?/);
      let diggCount = null;
      if (diggMatch?.[1]) {
        diggCount = diggMatch[1].includes('万')
          ? Math.round(Number(diggMatch[1].replace('万', '')) * 10000)
          : Number(diggMatch[1]);
      }
      return {
        cid: tooltip.replace(/^tooltip_/, '') || 'dom-' + index + '-' + (userLink?.href || '') + '-' + text,
        text: text || '[表情/图片评论]',
        create_time: null,
        digg_count: Number.isFinite(diggCount) ? diggCount : null,
        reply_comment_total: null,
        user_nickname: userLink?.innerText?.trim() || '',
        user_uid: '',
        user_sec_uid: (userLink?.href || '').split('/user/')[1] || '',
      };
    }).filter((comment) => comment.text || comment.user_nickname))()
  `;
}

async function activateNoteCommentsTab(cdp, target) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const state = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          if (!/\\/note\\//.test(location.pathname)) return { isNote: false, active: false };
          const activeScroller = Array.from(document.querySelectorAll('.comment-mainContent, [class*="comment-mainContent"]'))
            .find((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && el.scrollHeight > el.clientHeight + 20;
            });
          if (activeScroller) return { isNote: true, active: true };
          const tab = Array.from(document.querySelectorAll('div,span,button'))
            .map((el) => {
              const text = (el.innerText || el.textContent || '').trim();
              const rect = el.getBoundingClientRect();
              return { el, text, rect, area: rect.width * rect.height };
            })
            .filter((item) =>
              /^评论\\(\\d+\\)$/.test(item.text) &&
              item.rect.width > 0 &&
              item.rect.height > 0 &&
              item.area < 20000
            )
            .sort((a, b) => a.area - b.area)[0]?.el;
          if (!tab) return { isNote: true, active: false, found: false };
          const rect = tab.getBoundingClientRect();
          return {
            isNote: true,
            active: false,
            found: true,
            text: (tab.innerText || tab.textContent || '').trim(),
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
          };
        })()
      `,
      returnByValue: true,
    }).then((result) => result.result?.value || {}).catch(() => ({}));

    if (!state.isNote) return false;
    if (state.active) return true;
    if (state.found && state.x && state.y) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: state.x,
        y: state.y,
      }).catch(() => {});
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: state.x,
        y: state.y,
        button: 'left',
        clickCount: 1,
      }).catch(() => {});
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: state.x,
        y: state.y,
        button: 'left',
        clickCount: 1,
      }).catch(() => {});
      console.log(`[${target.awemeId || target.url}] clicked note comments tab ${state.text || ''}`.trim());
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return false;
}

async function scrapeOne(target, options) {
  const page = await createPage(options.cdpBase);
  const cdp = await connect(page.webSocketDebuggerUrl);
  const comments = new Map();
  const responseUrls = new Map();
  let sawCommentApi = false;
  let lastNewAt = Date.now();
  let sawNoMoreComments = false;

  try {
  cdp.on('Network.responseReceived', (params) => {
    const url = params.response?.url || '';
    if (/comment|reply/i.test(url) && /douyin\.com|amemv\.com|snssdk\.com/.test(url)) {
      responseUrls.set(params.requestId, url);
      sawCommentApi = true;
    }
  });

  cdp.on('Network.loadingFinished', async (params) => {
    const url = responseUrls.get(params.requestId);
    if (!url) return;
    responseUrls.delete(params.requestId);
    try {
      const body = await cdp.send('Network.getResponseBody', { requestId: params.requestId });
      const parsed = JSON.parse(body.body);
      for (const comment of collectComments(parsed)) {
        if (!comments.has(comment.cid)) {
          comments.set(comment.cid, comment);
          lastNewAt = Date.now();
        }
      }
      console.log(`[${target.awemeId || target.url}] comments=${comments.size} from ${new URL(url).pathname}`);
    } catch {
      // Some responses are encoded, cached, or already evicted from CDP.
    }
  });

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable', { maxResourceBufferSize: 10000000, maxTotalBufferSize: 50000000 });
  await cdp.send('Page.navigate', { url: target.url });
  await cdp.send('Page.bringToFront');
  await new Promise((resolve) => setTimeout(resolve, 1200));
  let clickedNoteCommentsTab = await activateNoteCommentsTab(cdp, target);

  const startedAt = Date.now();
  while (
    Date.now() - startedAt < options.maxRunMs &&
    Date.now() - lastNewAt < options.maxIdleMs &&
    comments.size < options.maxComments
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const scrollState = await cdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          let clickedNoteCommentsTab = false;
          let visibleCommentScroller = Array.from(document.querySelectorAll('.comment-mainContent, [class*="comment-mainContent"]'))
            .find((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && el.scrollHeight > el.clientHeight + 20;
            });
          const candidates = Array.from(document.querySelectorAll('*')).filter((el) => {
            const style = getComputedStyle(el);
            return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 100;
          }).sort((a, b) => b.clientHeight - a.clientHeight);
          const scroller = visibleCommentScroller || candidates[0] || document.scrollingElement || document.documentElement;
          const delta = Math.max(600, scroller.clientHeight * 0.9);
          scroller.scrollTop += delta;
          scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
          scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: delta, deltaMode: 0 }));
          if (!visibleCommentScroller) window.scrollBy(0, Math.max(600, innerHeight * 0.85));
          const rect = scroller.getBoundingClientRect();
          const text = document.body.innerText || '';
          return {
            href: location.href,
            title: document.title,
            top: scroller.scrollTop,
            height: scroller.scrollHeight,
            wheelX: Math.max(1, Math.round(rect.left + rect.width / 2)),
            wheelY: Math.max(1, Math.round(rect.top + rect.height / 2)),
            wheelDelta: delta,
            hasVisibleCommentScroller: Boolean(visibleCommentScroller),
            clickedNoteCommentsTab,
            noMoreComments: /暂时没有更多评论|没有更多评论|没有更多了|到底了/.test(text),
          };
        })()
      `,
      returnByValue: true,
    }).then((result) => result.result?.value || {}).catch(() => ({}));
    if (scrollState?.clickedNoteCommentsTab && !clickedNoteCommentsTab) {
      clickedNoteCommentsTab = true;
      console.log(`[${target.awemeId || target.url}] clicked note comments tab`);
    }
    if (scrollState?.hasVisibleCommentScroller && scrollState.wheelX && scrollState.wheelY) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: scrollState.wheelX,
        y: scrollState.wheelY,
        deltaY: scrollState.wheelDelta || 700,
        deltaX: 0,
      }).catch(() => {});
    }
    if (scrollState?.noMoreComments) {
      sawNoMoreComments = true;
      console.log(`[${target.awemeId || target.url}] no more comments on page`);
    }
    if (sawNoMoreComments) break;
  }

  const finalState = await cdp.send('Runtime.evaluate', {
    expression: '({ href: location.href, title: document.title })',
    returnByValue: true,
  }).then((result) => result.result?.value || {}).catch(() => ({}));
  const finalUrl = finalState.href || target.url;
  const finalWork = workFromUrl(finalUrl);
  const finalId = finalWork.id || target.awemeId;
  const finalType = finalWork.type || target.itemType;
  const finalTarget = {
    ...target,
    awemeId: finalId,
    itemType: finalType,
    url: canonicalUrl({ id: finalId, type: finalType }, finalUrl),
  };

  if (comments.size === 0 || finalTarget.itemType === 'note') {
    const domComments = await cdp.send('Runtime.evaluate', {
      expression: domCommentExtractionExpression(),
      returnByValue: true,
    }).then((result) => result.result?.value || []).catch(() => []);
    for (const comment of domComments) {
      const normalized = normalizeComment(comment);
      if (normalized && !comments.has(normalized.cid)) {
        comments.set(normalized.cid, normalized);
      }
    }
    if (domComments.length) {
      console.log(`[${finalTarget.awemeId || finalTarget.url}] comments=${comments.size} from DOM`);
    }
  }

  const rows = Array.from(comments.values()).slice(0, options.maxComments);
  const payload = {
    inputUrl: finalTarget.inputUrl,
    targetUrl: finalTarget.url,
    awemeId: finalTarget.awemeId,
    itemType: finalTarget.itemType,
    title: finalState.title || null,
    scrapedAt: new Date().toISOString(),
    maxComments: options.maxComments,
    count: rows.length,
    sawCommentApi,
    sawNoMoreComments,
    comments: rows,
  };
  const files = await writeOutputs(options.outDir, outputBase(finalTarget), payload);
  cdp.close();
  return { ...files, count: rows.length, sawCommentApi, sawNoMoreComments, awemeId: finalTarget.awemeId, targetUrl: finalTarget.url, title: payload.title };
  } catch (error) {
    cdp.close();
    throw error;
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

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
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
  if (!Number.isFinite(options.maxComments) || options.maxComments < 1) {
    throw new Error('--max must be a positive number');
  }
  if (!Number.isFinite(options.concurrency) || options.concurrency < 1) {
    throw new Error('--concurrency must be a positive number');
  }
  options.concurrency = Math.max(1, Math.floor(options.concurrency));

  await getJson(`${options.cdpBase}/json/version`).catch((error) => {
    throw new Error(`Cannot connect to Chrome CDP at ${options.cdpBase}. Run scripts/ensure_chrome_cdp.mjs first to start the persistent Douyin CDP Chrome profile. ${error.message}`);
  });

  const targets = urls.map(normalizeTarget);
  const results = await runWithConcurrency(targets, options.concurrency, (target) => scrapeOne(target, options));
  await fs.mkdir(options.outDir, { recursive: true });
  await fs.writeFile(path.join(options.outDir, 'douyin_comments_summary.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
