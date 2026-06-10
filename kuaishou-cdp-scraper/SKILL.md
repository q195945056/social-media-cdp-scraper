---
name: kuaishou-cdp-scraper
description: Scrape Kuaishou comments or work-level metrics through a real Chrome browser connected by Chrome DevTools Protocol (CDP). Use when the user asks to 抓取/导出/采集 快手作品评论, 评论明细, 点赞数, 评论数, 收藏数, 转发数, 发布时间, or provides Kuaishou short-video/share links for CSV exports.
---

# Kuaishou CDP Scraper

Use a real Chrome instance with CDP enabled, then choose the appropriate capability reference:

- For comment rows, follow `references/comments.md`.
- For work-level metrics such as like count, comment count, collect count, share count, and publish time, follow `references/work-stats.md`.

Both capabilities share the same Chrome CDP setup.

## Shared Chrome CDP Setup

1. Check whether Chrome CDP is already available:

```bash
curl -s http://127.0.0.1:9222/json/version
```

2. If available, reuse it. Do not start another Chrome.

3. If unavailable, start real Chrome with the bundled helper:

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node /Users/yanmingjun/.codex/skills/kuaishou-cdp-scraper/scripts/ensure_chrome_cdp.mjs
```

The helper uses a fixed persistent profile at `~/.codex/chrome-profiles/kuaishou-cdp` by default. If the user wants a different persistent CDP profile, set `KUAISHOU_CDP_USER_DATA_DIR=/absolute/path`.

## Routing

- If the user asks for comments, comment content, commenters, comment likes, or a max comment count, use `references/comments.md`.
- If the user asks for work data, likes, comment count, collect count, share count, forward count, publish time, or batch metrics, use `references/work-stats.md`.
- If the user asks for both comments and work stats, run the two scripts separately and report both output sets.

## Operational Notes

- The scripts require Node.js 22+ because they use built-in `fetch` and `WebSocket`.
- Request escalation before starting Chrome, because it launches a GUI app.
- In this Codex sandbox, run helper and scraper commands with the `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy node ...` prefix so local CDP access is allowed and not routed through proxies.
- Batch scraping supports `--concurrency N`. Use `1` for safest behavior, `2` or `3` for moderate parallelism.
- Comment and work stats scraping reuse the Chrome tabs they create across works, avoid bringing Chrome to the foreground, and close those tabs after the queue finishes. The scripts create tabs in the background when Chrome supports it.
- Kuaishou share pages may return risk-control or recommendation redirects. The scripts record the final `photoId` and leave unavailable fields blank rather than guessing.
- If outputs are empty, inspect the Chrome page for login, CAPTCHA, age gate, network failure, risk-control, or a non-video page. Do not bypass CAPTCHA; ask the user to handle it.
- Do not inspect cookies, local storage, passwords, or browser profile files.
