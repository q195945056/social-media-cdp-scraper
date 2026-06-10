# Unified Comment Export

Use this reference when the user asks to scrape or export Douyin or Kuaishou work comments.

## Input

- Accept one Douyin/Kuaishou URL or many URLs, including mixed-platform batches.
- Pass `--url` multiple times. Do not create intermediate `.txt` files unless the user explicitly provides one.
- Default to `--max 1000` unless the user gives another per-work limit.
- The router auto-detects platform from domains such as `douyin.com`, `v.douyin.com`, `kuaishou.com`, `v.kuaishou.com`, and `chenzhongtech.com`.

## Single Or Batch

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node /Users/yanmingjun/.codex/skills/douyin-cdp-scraper/scripts/scrape_platform_comments_cdp.mjs \
  --url "https://www.douyin.com/video/7598470240644664611" \
  --url "https://v.kuaishou.com/KNtcMaqR" \
  --max 1000 \
  --concurrency 2 \
  --out-dir ./platform-comments
```

Use `1` for safest behavior, `2` or `3` for moderate parallelism.

## Outputs

- Douyin per-work comments CSV: `douyin_comments_<aweme_id>.csv`
- Kuaishou per-work comments CSV: `kuaishou_comments_<photoId>.csv`
- No JSON files are written.

The CSV uses Chinese headers:

`昵称,评论内容,评论时间,点赞数,回复数`

`评论时间` uses Beijing time in `yyyy-MM-dd HH:mm:ss` format when parseable. Kuaishou DOM-rendered comments may expose only relative times; those rows leave `评论时间` blank rather than inventing a timestamp.

Platform-specific details: `douyin-comments.md`, `kuaishou-comments.md`.
