# Comment Export

Use this reference when the user asks to scrape or export Douyin work comments.

## Input

- Accept one Douyin URL or many URLs.
- Accept direct `/video/<aweme_id>` links, `/note/<aweme_id>` links, and search/modal links containing `modal_id=<aweme_id>`.
- Default to `--max 1000` unless the user gives another per-work limit.

## Single Work

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node /Users/yanmingjun/.codex/skills/douyin-comments-cdp/scripts/scrape_douyin_comments_cdp.mjs \
  --url "https://www.douyin.com/video/7598470240644664611" \
  --max 1000 \
  --concurrency 1 \
  --out-dir ./douyin-comments
```

## Batch

Pass `--url` multiple times or create a newline-delimited URL file:

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node /Users/yanmingjun/.codex/skills/douyin-comments-cdp/scripts/scrape_douyin_comments_cdp.mjs \
  --input urls.txt \
  --max 500 \
  --concurrency 2 \
  --out-dir ./douyin-comments
```

## Outputs

- Per work JSON: `douyin_comments_<aweme_id>.json`
- Per work CSV: `douyin_comments_<aweme_id>.csv`
- Batch summary: `douyin_comments_summary.json`

Confirm JSON `count` and CSV data rows match the requested cap or the number actually loaded before the page stopped producing new comments. Treat the result as “up to N comments per work”; Douyin may stop returning more comments before the limit.
