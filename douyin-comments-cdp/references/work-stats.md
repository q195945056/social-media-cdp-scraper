# Work Stats Export

Use this reference when the user asks to scrape or export Douyin work-level metrics.

## Fields

The scraper exports:

- `like_count`: 点赞数
- `comment_count`: 评论数
- `collect_count`: 收藏数
- `share_count`: 转发/分享数
- `publish_time`: 发布时间 ISO string when parseable
- `publish_timestamp`: 发布时间 Unix timestamp when parseable

## Input

- Accept one Douyin URL or many URLs.
- Accept direct `/video/<aweme_id>` links, `/note/<aweme_id>` links, and search/modal links containing `modal_id=<aweme_id>`.
- Use `--concurrency 1` by default unless the user asks for parallel scraping.

## Single Work

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node /Users/yanmingjun/.codex/skills/douyin-comments-cdp/scripts/scrape_douyin_work_stats_cdp.mjs \
  --url "https://www.douyin.com/video/7598470240644664611" \
  --concurrency 1 \
  --out-dir ./douyin-work-stats
```

## Batch And Concurrency

Pass `--url` multiple times or create a newline-delimited URL file. Use `--concurrency N` for parallel scraping:

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node /Users/yanmingjun/.codex/skills/douyin-comments-cdp/scripts/scrape_douyin_work_stats_cdp.mjs \
  --input urls.txt \
  --concurrency 2 \
  --out-dir ./douyin-work-stats
```

Use `1` for safest behavior, `2` or `3` for moderate parallelism.

## Outputs

- Per work JSON: `douyin_work_stats_<aweme_id>.json`
- Per work CSV: `douyin_work_stats_<aweme_id>.csv`
- Batch summary: `douyin_work_stats_summary.json`

If metric fields are empty, inspect the Chrome page for login, CAPTCHA, age gate, network failure, or a non-video page.
