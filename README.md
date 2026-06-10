# Social Media CDP Scraper

这个仓库提供一个统一的 Codex skill：

- `social-media-cdp-scraper`

它通过带 Chrome DevTools Protocol（CDP）的真实 Chrome 浏览器抓取抖音/快手作品数据和评论，并根据链接域名自动识别平台。

```text
social-media-cdp-scraper/
  SKILL.md
  references/
    comments.md              # 统一评论抓取入口
    work-stats.md            # 统一作品数据抓取入口
    douyin-comments.md       # 抖音评论细节
    douyin-work-stats.md     # 抖音作品数据细节
    kuaishou-comments.md     # 快手评论细节
    kuaishou-work-stats.md   # 快手作品数据细节
  scripts/
    ensure_chrome_cdp.mjs
    scrape_platform_comments_cdp.mjs
    scrape_platform_work_stats_cdp.mjs
    scrape_douyin_comments_cdp.mjs
    scrape_douyin_work_stats_cdp.mjs
    scrape_kuaishou_comments_cdp.mjs
    scrape_kuaishou_work_stats_cdp.mjs
```

## 能力

- 自动识别抖音/快手链接。
- 评论明细抓取：昵称、评论内容、评论时间、点赞数、回复数。
- 作品数据抓取：达人昵称、作品 ID、作品链接、作品标题、发布时间、点赞、评论、收藏、转发。
- 支持批量链接和并发抓取。
- 快手作品数据抓取会模拟 iPhone Safari；快手评论抓取不模拟手机。

## 安装

在 Codex 里直接说：

```text
安装这个 skill：
https://github.com/q195945056/social-media-cdp-scraper/tree/main/social-media-cdp-scraper
```

或者使用 `repo + path` 写法：

```text
用 skill-installer 安装 GitHub 上的 skill：
repo: q195945056/social-media-cdp-scraper
path: social-media-cdp-scraper
```

安装完成后，重启 Codex，让新的 skill 生效。

## 手动安装

```bash
mkdir -p ~/.codex/skills
git clone https://github.com/q195945056/social-media-cdp-scraper.git /tmp/social-media-cdp-scraper
cp -R /tmp/social-media-cdp-scraper/social-media-cdp-scraper ~/.codex/skills/
```

然后重启 Codex。

## 评论抓取

单个作品：

```text
[$social-media-cdp-scraper] 抓取这个作品前 500 条评论：https://www.douyin.com/video/...
```

混合平台批量：

```text
[$social-media-cdp-scraper] 抓取这些作品评论，每个最多 300 条，并发 2：
https://www.douyin.com/video/...
https://v.kuaishou.com/KNtcMaqR
```

评论按作品分别输出 CSV：

- 抖音：`douyin_comments_<awemeId>.csv`
- 快手：`kuaishou_comments_<photoId>.csv`

表头：

```text
昵称,评论内容,评论时间,点赞数,回复数
```

评论时间能解析时使用北京时间 `yyyy-MM-dd HH:mm:ss`。快手网页评论有时只暴露相对时间，这种情况下 `评论时间` 会留空，不编造时间。

## 作品数据抓取

单个作品：

```text
[$social-media-cdp-scraper] 抓取这个作品的点赞、评论、收藏、转发数和发布时间：https://www.douyin.com/video/...
```

混合平台批量：

```text
[$social-media-cdp-scraper] 批量抓取这些作品数据，并发 2，导出到 ./platform-work-stats：
https://www.douyin.com/video/...
https://v.kuaishou.com/KNtcMaqR
```

统一入口只输出一个合并汇总 CSV：

```text
work_stats_summary.csv
```

表头：

```text
平台,达人昵称,作品ID,作品链接,作品标题,发布时间,点赞,评论,收藏,转发
```

发布时间能解析时使用北京时间 `yyyy-MM-dd HH:mm:ss`。

## 使用前准备

- 安装 Chrome。
- 安装 Node.js 22 或更高版本。
- 第一次使用时，在 CDP Chrome 窗口里登录需要登录的平台。

## 注意事项

- 如果抓取结果为空，通常需要检查是否登录、是否出现验证码、链接是否是作品页。
- 不要尝试绕过验证码；需要用户自己在浏览器里完成登录验证。
- 快手公开网页可能返回风控或推荐跳转；脚本会记录最终 `photoId`，无法稳定获得的字段会留空。
