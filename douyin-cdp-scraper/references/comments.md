# Comment Export

Use this reference when the user asks to scrape or export Douyin work comments.

## Input

- Accept one Douyin URL or many URLs.
- Accept direct `/video/<aweme_id>` links, `/note/<aweme_id>` links, and search/modal links containing `modal_id=<aweme_id>`.
- Default to `--max 1000` unless the user gives another per-work limit.

## Single Work

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node /Users/yanmingjun/.codex/skills/douyin-cdp-scraper/scripts/scrape_douyin_comments_cdp.mjs \
  --url "https://www.douyin.com/video/7598470240644664611" \
  --max 1000 \
  --concurrency 1 \
  --out-dir ./douyin-comments
```

## Batch

Pass `--url` multiple times:

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node /Users/yanmingjun/.codex/skills/douyin-cdp-scraper/scripts/scrape_douyin_comments_cdp.mjs \
  --url "https://www.douyin.com/video/7598470240644664611" \
  --url "https://www.douyin.com/video/7598470240644664612" \
  --max 500 \
  --concurrency 2 \
  --out-dir ./douyin-comments
```

Use `1` for safest behavior, `2` or `3` for moderate parallelism.
The scraper opens at most one Chrome tab per worker, reuses it for multiple works, avoids focusing Chrome, and closes the created tabs after the batch finishes.

## Outputs

- Per work comments CSV: `douyin_comments_<aweme_id>.csv`
- No JSON files are written.

The CSV uses Chinese headers:

`昵称,评论内容,评论时间,点赞数,回复数`

`评论时间` uses Beijing time in `yyyy-MM-dd HH:mm:ss` format when parseable.

Confirm each CSV's data rows match the requested cap or the number actually loaded before the page stopped producing new comments. Treat the result as “up to N comments per work”; Douyin may stop returning more comments before the limit.
