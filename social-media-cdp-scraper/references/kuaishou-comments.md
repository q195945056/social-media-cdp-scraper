# Comment Export

Use this reference when the user asks to scrape or export Kuaishou work comments.

## Input

- Accept one Kuaishou URL or many URLs.
- Accept direct `/short-video/<photoId>` links, `/fw/photo/<photoId>` links, `/f/<token>` share links, and `v.kuaishou.com` short links.
- Default to `--max 1000` unless the user gives another per-work limit.
- Pass `--url` multiple times. Do not create intermediate `.txt` files unless the user explicitly provides one.

## Single Work

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node /Users/yanmingjun/.codex/skills/douyin-cdp-scraper/scripts/scrape_kuaishou_comments_cdp.mjs \
  --url "https://www.kuaishou.com/short-video/3xe9fv8asqzes6i" \
  --max 1000 \
  --concurrency 1 \
  --out-dir ./kuaishou-comments
```

## Batch And Concurrency

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node /Users/yanmingjun/.codex/skills/douyin-cdp-scraper/scripts/scrape_kuaishou_comments_cdp.mjs \
  --url "https://www.kuaishou.com/f/X-2mC8JJMsBkp1yn" \
  --url "https://v.kuaishou.com/KNtcMaqR" \
  --max 500 \
  --concurrency 2 \
  --out-dir ./kuaishou-comments
```

Use `1` for safest behavior, `2` or `3` for moderate parallelism.
The scraper opens at most one Chrome tab per worker, reuses it for multiple works, avoids focusing Chrome, and closes the created tabs after the batch finishes.
It uses the normal Chrome page and does not emulate mobile.

## Outputs

- Per work comments CSV: `kuaishou_comments_<photoId>.csv`
- No JSON files are written.

The CSV uses Chinese headers:

`昵称,评论内容,评论时间,点赞数,回复数`

`评论时间` uses Beijing time in `yyyy-MM-dd HH:mm:ss` format when parseable. Kuaishou DOM-rendered comments often expose only relative times such as `2周前`; those rows leave `评论时间` blank rather than inventing a timestamp.

Treat the result as “up to N comments per work”; Kuaishou may stop rendering more comments before the limit.
