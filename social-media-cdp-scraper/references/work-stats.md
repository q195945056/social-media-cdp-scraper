# Unified Work Stats Export

Use this reference when the user asks to scrape or export Douyin or Kuaishou work-level metrics.

## Fields

The router writes a combined summary CSV with Chinese headers:

`平台,达人昵称,作品ID,作品链接,作品标题,发布时间,点赞,评论,收藏,转发`

`发布时间` uses Beijing time in `yyyy-MM-dd HH:mm:ss` format when parseable.

## Input

- Accept one Douyin/Kuaishou URL or many URLs, including mixed-platform batches.
- Pass `--url` multiple times. Do not create intermediate `.txt` files unless the user explicitly provides one.
- The router auto-detects platform from domains such as `douyin.com`, `v.douyin.com`, `kuaishou.com`, `v.kuaishou.com`, and `chenzhongtech.com`.

## Single Or Batch

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node /Users/yanmingjun/.codex/skills/douyin-cdp-scraper/scripts/scrape_platform_work_stats_cdp.mjs \
  --url "https://www.douyin.com/video/7598470240644664611" \
  --url "https://v.kuaishou.com/KNtcMaqR" \
  --concurrency 2 \
  --out-dir ./platform-work-stats
```

Use `1` for safest behavior, `2` or `3` for moderate parallelism.

## Outputs

- Combined summary CSV: `work_stats_summary.csv`
- Platform raw CSVs are kept in subdirectories:
  - `douyin/douyin_work_stats_summary.csv`
  - `kuaishou/kuaishou_work_stats_summary.csv`

Kuaishou work stats scraping emulates iPhone Safari. Kuaishou public mobile pages may omit发布时间 or share counts; leave unavailable fields blank rather than guessing.

Platform-specific details: `douyin-work-stats.md`, `kuaishou-work-stats.md`.
