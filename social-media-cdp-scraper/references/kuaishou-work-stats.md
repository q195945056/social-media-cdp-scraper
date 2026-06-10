# Work Stats Export

Use this reference when the user asks to scrape or export Kuaishou work-level metrics.

## Fields

The scraper exports one summary CSV with these Chinese headers:

`达人昵称,photoId,作品链接,作品标题,发布时间,点赞,评论,收藏,转发`

`发布时间` uses Beijing time in `yyyy-MM-dd HH:mm:ss` format when parseable.

## Input

- Accept one Kuaishou URL or many URLs.
- Accept direct `/short-video/<photoId>` links, `/fw/photo/<photoId>` links, `/f/<token>` share links, and `v.kuaishou.com` short links.
- Pass `--url` multiple times. Do not create intermediate `.txt` files unless the user explicitly provides one.

## Single Work

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node /Users/yanmingjun/.codex/skills/douyin-cdp-scraper/scripts/scrape_kuaishou_work_stats_cdp.mjs \
  --url "https://www.kuaishou.com/short-video/3xe9fv8asqzes6i" \
  --concurrency 1 \
  --out-dir ./kuaishou-work-stats
```

## Batch And Concurrency

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node /Users/yanmingjun/.codex/skills/douyin-cdp-scraper/scripts/scrape_kuaishou_work_stats_cdp.mjs \
  --url "https://www.kuaishou.com/f/X-2mC8JJMsBkp1yn" \
  --url "https://v.kuaishou.com/KNtcMaqR" \
  --concurrency 2 \
  --out-dir ./kuaishou-work-stats
```

Use `1` for safest behavior, `2` or `3` for moderate parallelism.
The scraper opens at most one Chrome tab per worker, reuses it for multiple works, avoids focusing Chrome, and closes the created tabs after the batch finishes.
It emulates iPhone Safari by default.

## Outputs

- Batch summary CSV: `kuaishou_work_stats_summary.csv`

Kuaishou may hide some counts on public web pages or return risk-control redirects. Leave unavailable fields blank.
