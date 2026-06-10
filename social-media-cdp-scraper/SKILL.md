---
name: douyin-cdp-scraper
description: Scrape Douyin or Kuaishou comments and work-level metrics through a real Chrome browser connected by Chrome DevTools Protocol (CDP). Use when the user asks to 抓取/导出/采集 抖音/快手作品数据、作品评论、评论明细、点赞数、评论数、收藏数、转发数、发布时间, or provides Douyin/Kuaishou links for CSV exports.
---

# Douyin/Kuaishou CDP Scraper

Use this unified skill for both Douyin and Kuaishou. The router scripts auto-detect the platform from each URL and call the correct platform-specific scraper.

- For comment rows, follow `references/comments.md`.
- For work-level metrics such as like count, comment count, collect count, share count, and publish time, follow `references/work-stats.md`.
- Platform-specific details remain available in `references/douyin-*.md` and `references/kuaishou-*.md` when debugging.

## Shared Chrome CDP Setup

1. Check whether Chrome CDP is already available:

```bash
curl -s http://127.0.0.1:9222/json/version
```

2. If available, reuse it. Do not start another Chrome.

3. If unavailable, start real Chrome with the bundled helper:

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node /Users/yanmingjun/.codex/skills/douyin-cdp-scraper/scripts/ensure_chrome_cdp.mjs
```

The helper uses a fixed persistent profile at `~/.codex/chrome-profiles/douyin-cdp` by default. This keeps login state across workspaces and future skill runs.

## Routing

- If the user asks for comments, comment content, commenters, comment likes, or a max comment count, use `references/comments.md`.
- If the user asks for work data, likes, comment count, collect count, share count, forward count, publish time, or batch metrics, use `references/work-stats.md`.
- If the user asks for both comments and work stats, run the two router scripts separately and report both output sets.

## Operational Notes

- The scripts require Node.js 22+ because they use built-in `fetch` and `WebSocket`.
- Request escalation before starting Chrome, because it launches a GUI app.
- In this Codex sandbox, run helper and scraper commands with the `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy node ...` prefix so local CDP access is allowed and not routed through proxies.
- Batch scraping supports `--concurrency N`. Use `1` for safest behavior, `2` or `3` for moderate parallelism.
- The router accepts mixed Douyin and Kuaishou links in one command. Unsupported URLs should fail fast instead of guessing.
- Douyin work stats and comments use normal Chrome behavior. Kuaishou work stats emulate iPhone Safari; Kuaishou comments use normal Chrome and do not emulate mobile.
- Comment and work stats scraping reuse Chrome tabs where the platform script supports it, avoid bringing Chrome to the foreground, and close created tabs after the queue finishes.
- Keep proxy variables unset for local CDP calls; otherwise Node may route `127.0.0.1` through a proxy.
- If outputs are empty, inspect the Chrome page for login, CAPTCHA, age gate, network failure, risk-control, or a non-video page. Do not bypass CAPTCHA; ask the user to handle it.
- Do not inspect cookies, local storage, passwords, or browser profile files.
