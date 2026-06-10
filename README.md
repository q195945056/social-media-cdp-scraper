# 抖音抓取 Codex Skill

这个仓库提供一个 Codex skill：`douyin-cdp-scraper`。

它通过带 Chrome DevTools Protocol（CDP）的真实 Chrome 浏览器抓取抖音数据，并把不同能力拆在 skill 内部的 `references/` 文档里：

```text
douyin-cdp-scraper/
  SKILL.md
  references/
    comments.md      # 评论明细抓取
    work-stats.md    # 作品数据抓取
  scripts/
    ensure_chrome_cdp.mjs
    scrape_douyin_comments_cdp.mjs
    scrape_douyin_work_stats_cdp.mjs
```

## 能力

- 评论明细抓取：评论内容、评论时间、评论点赞数、用户昵称等。
- 作品数据抓取：点赞数、评论数、收藏数、转发数、发布时间。
- 两种能力都支持批量链接。
- 两种能力都支持并发抓取。

## 推荐安装方式

在 Codex 里直接说：

```text
安装这个 skill：
https://github.com/q195945056/douyin-cdp-scraper/tree/main/douyin-cdp-scraper
```

或者使用更明确的 `repo + path` 写法：

```text
用 skill-installer 安装 GitHub 上的 skill：
repo: q195945056/douyin-cdp-scraper
path: douyin-cdp-scraper
```

安装完成后，重启 Codex，让新的 skill 生效。

## 手动安装方式

如果不通过 Codex 自动安装，也可以手动复制目录：

```bash
mkdir -p ~/.codex/skills
git clone https://github.com/q195945056/douyin-cdp-scraper.git /tmp/douyin-cdp-scraper
cp -R /tmp/douyin-cdp-scraper/douyin-cdp-scraper ~/.codex/skills/
```

然后重启 Codex。

## 评论抓取使用方式

单个作品：

```text
[$douyin-cdp-scraper] 抓取这个抖音作品前 500 条评论：https://www.douyin.com/video/...
```

多个作品：

```text
[$douyin-cdp-scraper] 抓取这些作品评论，每个最多 300 条：
https://www.douyin.com/video/...
https://www.douyin.com/video/...
```

并发抓取：

```text
[$douyin-cdp-scraper] 批量抓取这些作品评论，每个最多 500 条，并发数 2，导出到 ./douyin-comments：
https://www.douyin.com/video/...
https://www.douyin.com/video/...
```

评论数据按作品分别输出 CSV：`douyin_comments_<awemeId>.csv`，不生成 JSON。表头为：`昵称, 评论内容, 评论时间, 点赞数, 回复数`，评论时间使用北京时间 `yyyy-MM-dd HH:mm:ss` 格式。

## 作品数据抓取使用方式

单个作品：

```text
[$douyin-cdp-scraper] 抓取这个抖音作品的点赞、评论、收藏、转发数和发布时间：https://www.douyin.com/video/...
```

多个作品：

```text
[$douyin-cdp-scraper] 批量抓取这些作品数据：
https://www.douyin.com/video/...
https://www.douyin.com/video/...
```

并发抓取：

```text
[$douyin-cdp-scraper] 批量抓取这些作品数据，并发数 2，导出到 ./douyin-work-stats：
https://www.douyin.com/video/...
https://www.douyin.com/video/...
```

作品数据只输出一个汇总 CSV：`douyin_work_stats_summary.csv`，表头包括：

```text
达人昵称, awemeId, 作品链接, 作品标题, 发布时间, 点赞, 评论, 收藏, 转发
```

其中发布时间使用北京时间 `yyyy-MM-dd HH:mm:ss` 格式。

## 使用前准备

- 安装 Chrome
- 安装 Node.js 22 或更高版本
- 第一次使用时，在 CDP Chrome 窗口里登录抖音

## 注意事项

- 如果抓取结果为空，通常需要检查是否登录、是否出现验证码、链接是否是作品页。
- 不要尝试绕过验证码；需要用户自己在浏览器里完成登录验证。
