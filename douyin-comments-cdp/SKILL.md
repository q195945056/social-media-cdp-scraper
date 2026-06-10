---
name: douyin-comments-cdp
description: Scrape comments from one or more Douyin video/work links through a real Chrome browser connected by Chrome DevTools Protocol (CDP). Use when the user asks to 抓取/导出/采集 抖音作品评论, provides Douyin video/search/modal links, wants JSON/CSV comment exports, or specifies a maximum number of comments to fetch per work.
---

# Douyin Comments CDP

Use a real Chrome instance with CDP enabled, then run the bundled scraper. The scraper listens to Douyin comment API responses while scrolling the video detail page, deduplicates comments, and writes both JSON and CSV.

## Workflow

1. Normalize the user's request:
   - Accept one Douyin URL or many URLs.
   - Accept direct `/video/<aweme_id>` links and search/modal links containing `modal_id=<aweme_id>`.
   - Default to `--max 1000` unless the user gives another per-video limit.

2. Start or reuse Chrome CDP:
   - Check `curl -s http://127.0.0.1:9222/json/version`.
   - If available, reuse it. Do not start another Chrome.
   - If unavailable, start real Chrome with the bundled helper:

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node /Users/yanmingjun/.codex/skills/douyin-comments-cdp/scripts/ensure_chrome_cdp.mjs
```

The helper uses a fixed persistent profile at `~/.codex/chrome-profiles/douyin-cdp` by default. This keeps Douyin login state across workspaces and future skill runs. If the user wants a different persistent CDP profile, set `DOUYIN_CDP_USER_DATA_DIR=/absolute/path`.

3. Run the bundled script from the user workspace, not from the skill directory:

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node /Users/yanmingjun/.codex/skills/douyin-comments-cdp/scripts/scrape_douyin_comments_cdp.mjs \
  --url "https://www.douyin.com/video/7598470240644664611" \
  --max 1000 \
  --concurrency 1 \
  --out-dir ./douyin-comments
```

4. For batch input, either pass `--url` multiple times or create a newline-delimited URL file:

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node /Users/yanmingjun/.codex/skills/douyin-comments-cdp/scripts/scrape_douyin_comments_cdp.mjs \
  --input urls.txt \
  --max 500 \
  --concurrency 2 \
  --out-dir ./douyin-comments
```

5. Verify outputs:
   - Per work: `douyin_comments_<aweme_id>.json` and `douyin_comments_<aweme_id>.csv`.
   - Batch summary: `douyin_comments_summary.json`.
   - Confirm JSON `count` and CSV data rows match the requested cap or the number actually loaded before the page stopped producing new comments.

## Operational Notes

- The script requires Node.js 22+ because it uses built-in `fetch` and `WebSocket`.
- Request escalation before starting Chrome, because it launches a GUI app.
- In this Codex sandbox, run both helper and scraper with the `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy node ...` prefix so local CDP access is allowed and not routed through proxies.
- Batch scraping supports `--concurrency N`. Use `1` for safest behavior, `2` or `3` for moderate parallelism. Avoid high values because every worker opens a separate Chrome page and Douyin may rate-limit or show verification prompts.
- Do not use a workspace-local `--user-data-dir` unless the user explicitly wants an isolated throwaway profile. It causes repeated Douyin login prompts when the skill is used from different workspaces.
- A normal already-open Chrome profile cannot be retrofitted with CDP. The user should log in once inside the persistent CDP Chrome window; future runs should reuse that profile.
- Keep proxy variables unset for local CDP calls; otherwise Node may route `127.0.0.1` through a proxy.
- If `sawCommentApi` is false or count is 0, inspect the Chrome page for login, CAPTCHA, age gate, network failure, or a non-video page. Do not bypass CAPTCHA; ask the user to handle it.
- Do not inspect cookies, local storage, passwords, or browser profile files.
- Treat the result as “up to N comments per work”; Douyin may stop returning more comments before the limit.
