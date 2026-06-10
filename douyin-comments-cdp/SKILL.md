---
name: douyin-comments-cdp
description: Scrape Douyin comments or work-level metrics through a real Chrome browser connected by Chrome DevTools Protocol (CDP). Use when the user asks to 抓取/导出/采集 抖音作品评论, 评论明细, 点赞数, 评论数, 收藏数, 转发数, 发布时间, or provides Douyin video/search/modal links for JSON/CSV exports.
---

# Douyin Comments CDP

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
  node /Users/yanmingjun/.codex/skills/douyin-comments-cdp/scripts/ensure_chrome_cdp.mjs
```

The helper uses a fixed persistent profile at `~/.codex/chrome-profiles/douyin-cdp` by default. This keeps Douyin login state across workspaces and future skill runs. If the user wants a different persistent CDP profile, set `DOUYIN_CDP_USER_DATA_DIR=/absolute/path`.

## Routing

- If the user asks for comments, comment content, commenters, comment likes, or a max comment count, use `references/comments.md`.
- If the user asks for work data, likes, comment count, collect count, share count, forward count, publish time, or batch metrics, use `references/work-stats.md`.
- If the user asks for both comments and work stats, run the two scripts separately and report both output sets.

## Operational Notes

- The scripts require Node.js 22+ because they use built-in `fetch` and `WebSocket`.
- Request escalation before starting Chrome, because it launches a GUI app.
- In this Codex sandbox, run helper and scraper commands with the `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy node ...` prefix so local CDP access is allowed and not routed through proxies.
- Batch scraping supports `--concurrency N`. Use `1` for safest behavior, `2` or `3` for moderate parallelism. Avoid high values because every worker opens a separate Chrome page and Douyin may rate-limit or show verification prompts.
- Do not use a workspace-local `--user-data-dir` unless the user explicitly wants an isolated throwaway profile. It causes repeated Douyin login prompts when the skill is used from different workspaces.
- A normal already-open Chrome profile cannot be retrofitted with CDP. The user should log in once inside the persistent CDP Chrome window; future runs should reuse that profile.
- Keep proxy variables unset for local CDP calls; otherwise Node may route `127.0.0.1` through a proxy.
- If outputs are empty, inspect the Chrome page for login, CAPTCHA, age gate, network failure, or a non-video page. Do not bypass CAPTCHA; ask the user to handle it.
- Do not inspect cookies, local storage, passwords, or browser profile files.
