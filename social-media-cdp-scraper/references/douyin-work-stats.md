# Work Stats Export

Use this reference when the user asks to scrape or export Douyin work-level metrics.

## Fields

The scraper exports:

- `author_nickname`: 达人昵称
- `awemeId`: 作品 ID
- `targetUrl`: 作品链接
- `title`: 作品标题
- `like_count`: 点赞数
- `comment_count`: 评论数
- `collect_count`: 收藏数
- `share_count`: 转发/分享数
- `publish_time`: 发布时间，格式为北京时间 `yyyy-MM-dd HH:mm:ss`

## Input

- Accept one Douyin URL or many URLs.
- Accept direct `/video/<aweme_id>` links, `/note/<aweme_id>` links, and search/modal links containing `modal_id=<aweme_id>`.
- Use `--concurrency 1` by default unless the user asks for parallel scraping.

## Single Work

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node /Users/yanmingjun/.codex/skills/douyin-cdp-scraper/scripts/scrape_douyin_work_stats_cdp.mjs \
  --url "https://www.douyin.com/video/7598470240644664611" \
  --concurrency 1 \
  --out-dir ./douyin-work-stats
```

## Batch And Concurrency

Pass `--url` multiple times. Use `--concurrency N` for parallel scraping:

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node /Users/yanmingjun/.codex/skills/douyin-cdp-scraper/scripts/scrape_douyin_work_stats_cdp.mjs \
  --url "https://www.douyin.com/video/7598470240644664611" \
  --url "https://www.douyin.com/video/7598470240644664612" \
  --concurrency 2 \
  --out-dir ./douyin-work-stats
```

Use `1` for safest behavior, `2` or `3` for moderate parallelism.
The scraper opens at most one Chrome tab per worker, reuses it for multiple works, avoids focusing Chrome, and closes the created tabs after the batch finishes.

## Outputs

- Batch summary CSV: `douyin_work_stats_summary.csv`

The CSV uses Chinese headers:

`达人昵称,awemeId,作品链接,作品标题,发布时间,点赞,评论,收藏,转发`

If metric fields are empty, inspect the Chrome page for login, CAPTCHA, age gate, network failure, or a non-video page.
