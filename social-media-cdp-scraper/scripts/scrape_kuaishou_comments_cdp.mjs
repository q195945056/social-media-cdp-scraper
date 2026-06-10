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
  node scrape_kuaishou_comments_cdp.mjs --url <kuaishou-url> [--url <kuaishou-url> ...] [--max 1000] [--concurrency 2] [--out-dir ./comments]
  node scrape_kuaishou_comments_cdp.mjs --input urls.txt --max 500 --concurrency 3 --out-dir ./comments

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
  if (directMatch) return { id: directMatch[1], type: 'photo' };
  const queryMatch = text.match(/[?&](?:photoId|photo_id|shareObjectId)=([A-Za-z0-9_-]+)/);
  if (queryMatch) return { id: queryMatch[1], type: 'photo' };
  return { id: null, type: null };
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
    itemType: work.type,
    url: canonicalUrl(work, rawUrl),
  };
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

function normalizeCommentTime(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const raw = Number(value);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const timestamp = raw > 100000000000 ? Math.round(raw / 1000) : raw;
    return formatBeijingTime(timestamp);
  }
  const parsed = Date.parse(String(value).trim().replace(/年|\/|\./g, '-').replace(/月/g, '-').replace(/日/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return formatBeijingTime(Math.round(parsed / 1000));
}

function normalizeComment(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const user = raw.user || raw.author || raw.userInfo || raw.user_info || {};
  const text = raw.text || raw.content || raw.comment_text || raw.comment || raw.message || '';
  const cid = raw.cid || raw.comment_id || raw.commentId || raw.id || `${user.id || user.userId || user.uid || ''}:${text}`;
  if (!text || !cid) return null;
  return {
    cid: String(cid),
    text: String(text).replace(/\s+/g, ' ').trim(),
    create_time: normalizeCommentTime(raw.create_time || raw.createTime || raw.timestamp || raw.time),
    digg_count: raw.digg_count ?? raw.like_count ?? raw.likeCount ?? raw.likedCount ?? null,
    reply_comment_total: raw.reply_comment_total ?? raw.reply_count ?? raw.replyCount ?? raw.subCommentCount ?? null,
    user_nickname: raw.user_nickname || user.nickname || user.name || user.userName || raw.userName || '',
    user_uid: raw.user_uid || user.uid || user.userId || user.id || '',
    user_sec_uid: raw.user_sec_uid || user.sec_uid || user.principalId || '',
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
  for (const key of ['comments', 'reply_comments', 'comment_list', 'commentList', 'rootComments', 'items', 'list', 'data']) {
    if (value[key]) collectComments(value[key], out);
  }
  return out;
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function outputBase(target) {
  return target.photoId ? `kuaishou_comments_${target.photoId}` : `kuaishou_comments_${Date.now()}`;
}

async function writeOutputCsv(outDir, base, payload) {
  await fs.mkdir(outDir, { recursive: true });
  const csvPath = path.join(outDir, `${base}.csv`);
  const columns = [
    ['昵称', 'user_nickname'],
    ['评论内容', 'text'],
    ['评论时间', 'create_time'],
    ['点赞数', 'digg_count'],
    ['回复数', 'reply_comment_total'],
  ];
  const rows = payload.comments.map((comment) => columns.map(([, key]) => csvEscape(comment[key])).join(','));
  await fs.writeFile(csvPath, [columns.map(([label]) => label).join(','), ...rows].join('\n'));
  return csvPath;
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

function domCommentExtractionExpression() {
  return `
    (() => Array.from(document.querySelectorAll('.comment-item.comment-list-item')).map((el, index) => {
      const normalizeCount = (value) => {
        if (value == null || value === '') return null;
        const text = String(value).replace(/,/g, '').trim();
        const match = text.match(/(\\d+(?:\\.\\d+)?)/);
        if (!match) return null;
        const number = Number(match[1]);
        if (!Number.isFinite(number)) return null;
        if (text.includes('亿')) return Math.round(number * 100000000);
        if (text.includes('万') || /w/i.test(text)) return Math.round(number * 10000);
        return Math.round(number);
      };
      const bodyLines = (el.querySelector('.comment-item-body')?.innerText || '').split('\\n').map((line) => line.trim()).filter(Boolean);
      const authorLine = (el.querySelector('.comment-item-author')?.innerText || bodyLines[0] || '').trim();
      const authorMatch = authorLine.match(/^(.*?)\\s*((?:刚刚|\\d+\\s*(?:秒|分钟|小时|天|周|月|年)前|\\d{4}[-/.年]\\d{1,2}[-/.月]\\d{1,2}日?(?:\\s+\\d{1,2}:\\d{2}(?::\\d{2})?)?))?$/);
      const nickname = (authorMatch?.[1] || authorLine).trim();
      const createTime = authorMatch?.[2] || null;
      const text = bodyLines.slice(1)
        .filter((line) => line !== '查看更多回复' && !/^\\d+$/.test(line))
        .join(' ')
        .trim() || '[表情/图片评论]';
      const allLines = (el.innerText || '').split('\\n').map((line) => line.trim()).filter(Boolean);
      const diggCount = normalizeCount([...allLines].reverse().find((line) => /^\\d+(?:\\.\\d+)?(?:万|亿)?$/.test(line)));
      const replyLine = allLines.find((line) => /查看.*回复/.test(line));
      const replyCount = normalizeCount(replyLine);
      return {
        cid: 'dom-' + index + '-' + nickname + '-' + text,
        text: text || '[表情/图片评论]',
        create_time: createTime,
        digg_count: Number.isFinite(diggCount) ? diggCount : null,
        reply_comment_total: Number.isFinite(replyCount) ? replyCount : null,
        user_nickname: nickname,
        user_uid: '',
        user_sec_uid: '',
      };
    }).filter((comment) => comment.user_nickname || comment.text))()
  `;
}

function apolloCommentExtractionExpression() {
  return `
    (() => {
      const state = window.__APOLLO_STATE__?.defaultClient || window.__APOLLO_STATE__ || {};
      const entries = Object.entries(state);
      const rows = [];
      for (const [key, value] of entries) {
        if (!value || typeof value !== 'object') continue;
        if (!/comment/i.test(key) && !value.content && !value.text) continue;
        const text = value.content || value.text || value.comment || value.message;
        if (!text) continue;
        const userRef = value.author?.id || value.user?.id || value.userInfo?.id;
        const user = (userRef && state[userRef]) || value.author || value.user || value.userInfo || {};
        rows.push({
          commentId: value.id || value.commentId || key,
          content: text,
          timestamp: value.timestamp || value.time || value.createTime || null,
          likeCount: value.likeCount ?? value.likedCount ?? value.diggCount ?? null,
          subCommentCount: value.subCommentCount ?? value.replyCount ?? null,
          user: {
            name: user.name || user.userName || user.nickname || '',
            id: user.id || user.userId || user.uid || '',
          },
        });
      }
      return rows;
    })()
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

async function scrapeOne(target, options, session) {
  const { cdp } = session;
  const comments = new Map();
  const responseUrls = new Map();
  let sawCommentApi = false;
  let lastNewAt = Date.now();
  let sawNoMoreComments = false;
  let offResponseReceived = null;
  let offLoadingFinished = null;

  try {
  offResponseReceived = cdp.on('Network.responseReceived', (params) => {
    const url = params.response?.url || '';
    if (/comment|reply/i.test(url) && /kuaishou\.com|chenzhongtech\.com|gifshow\.com/.test(url)) {
      responseUrls.set(params.requestId, url);
      sawCommentApi = true;
    }
  });

  offLoadingFinished = cdp.on('Network.loadingFinished', async (params) => {
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
      console.log(`[${target.photoId || target.url}] comments=${comments.size} from ${new URL(url).pathname}`);
    } catch {
      // Some responses are encoded, cached, or already evicted from CDP.
    }
  });

  await cdp.send('Page.navigate', { url: target.url });
  await new Promise((resolve) => setTimeout(resolve, 1200));

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
      console.log(`[${target.photoId || target.url}] no more comments on page`);
    }
    if (sawNoMoreComments) break;
  }

  const finalState = await cdp.send('Runtime.evaluate', {
    expression: '({ href: location.href, title: document.title })',
    returnByValue: true,
  }).then((result) => result.result?.value || {}).catch(() => ({}));
  const finalUrl = finalState.href || target.url;
  const finalWork = workFromUrl(finalUrl);
  const finalId = finalWork.id || target.photoId;
  const finalType = finalWork.type || target.itemType;
  const finalTarget = {
    ...target,
    photoId: finalId,
    itemType: finalType,
    url: canonicalUrl({ id: finalId, type: finalType }, finalUrl),
  };

  if (comments.size === 0) {
    const apolloComments = await cdp.send('Runtime.evaluate', {
      expression: apolloCommentExtractionExpression(),
      returnByValue: true,
    }).then((result) => result.result?.value || []).catch(() => []);
    for (const comment of apolloComments) {
      const normalized = normalizeComment(comment);
      if (normalized && !comments.has(normalized.cid)) {
        comments.set(normalized.cid, normalized);
      }
    }
    if (apolloComments.length) {
      console.log(`[${finalTarget.photoId || finalTarget.url}] comments=${comments.size} from Apollo`);
    }
  }

  if (comments.size === 0) {
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
      console.log(`[${finalTarget.photoId || finalTarget.url}] comments=${comments.size} from DOM`);
    }
  }

  const rows = Array.from(comments.values()).slice(0, options.maxComments);
  const payload = {
    inputUrl: finalTarget.inputUrl,
    targetUrl: finalTarget.url,
    photoId: finalTarget.photoId,
    itemType: finalTarget.itemType,
    title: finalState.title || null,
    scrapedAt: new Date().toISOString(),
    maxComments: options.maxComments,
    count: rows.length,
    sawCommentApi,
    sawNoMoreComments,
    comments: rows,
  };
  const csvPath = await writeOutputCsv(options.outDir, outputBase(finalTarget), payload);
  return { csvPath, count: rows.length, sawCommentApi, sawNoMoreComments, photoId: finalTarget.photoId, targetUrl: finalTarget.url, title: payload.title };
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
  if (!Number.isFinite(options.maxComments) || options.maxComments < 1) {
    throw new Error('--max must be a positive number');
  }
  if (!Number.isFinite(options.concurrency) || options.concurrency < 1) {
    throw new Error('--concurrency must be a positive number');
  }
  options.concurrency = Math.max(1, Math.floor(options.concurrency));

  await getJson(`${options.cdpBase}/json/version`).catch((error) => {
    throw new Error(`Cannot connect to Chrome CDP at ${options.cdpBase}. Run scripts/ensure_chrome_cdp.mjs first to start the persistent Kuaishou CDP Chrome profile. ${error.message}`);
  });

  const targets = urls.map(normalizeTarget);
  const results = await scrapeWithConcurrency(targets, options);
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
