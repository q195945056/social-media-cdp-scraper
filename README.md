# 抖音抓取 Codex Skill

这个仓库提供一个 Codex skill：`douyin-comments-cdp`。

它通过带 Chrome DevTools Protocol（CDP）的真实 Chrome 浏览器抓取抖音数据，并把不同能力拆在 skill 内部的 `references/` 文档里：

```text
douyin-comments-cdp/
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
https://github.com/q195945056/douyin-comments-cdp/tree/main/douyin-comments-cdp
```

或者使用更明确的 `repo + path` 写法：

```text
用 skill-installer 安装 GitHub 上的 skill：
repo: q195945056/douyin-comments-cdp
path: douyin-comments-cdp
```

安装完成后，重启 Codex，让新的 skill 生效。

## 手动安装方式

如果不通过 Codex 自动安装，也可以手动复制目录：

```bash
mkdir -p ~/.codex/skills
git clone https://github.com/q195945056/douyin-comments-cdp.git /tmp/douyin-comments-cdp
cp -R /tmp/douyin-comments-cdp/douyin-comments-cdp ~/.codex/skills/
```

然后重启 Codex。

## 评论抓取使用方式

单个作品：

```text
[$douyin-comments-cdp] 抓取这个抖音作品前 500 条评论：https://www.douyin.com/video/...
```

多个作品：

```text
[$douyin-comments-cdp] 抓取这些作品评论，每个最多 300 条：
https://www.douyin.com/video/...
https://www.douyin.com/video/...
```

并发抓取：

```text
[$douyin-comments-cdp] 批量抓取 urls.txt 里的作品评论，每个最多 500 条，并发数 2，导出到 ./douyin-comments
```

## 作品数据抓取使用方式

单个作品：

```text
[$douyin-comments-cdp] 抓取这个抖音作品的点赞、评论、收藏、转发数和发布时间：https://www.douyin.com/video/...
```

多个作品：

```text
[$douyin-comments-cdp] 批量抓取这些作品数据：
https://www.douyin.com/video/...
https://www.douyin.com/video/...
```

并发抓取：

```text
[$douyin-comments-cdp] 批量抓取 urls.txt 里的作品数据，并发数 2，导出到 ./douyin-work-stats
```

作品数据输出字段包括：

```text
like_count, comment_count, collect_count, share_count, publish_time, publish_timestamp
```

## 使用前准备

- 安装 Chrome
- 安装 Node.js 22 或更高版本
- 第一次使用时，在 CDP Chrome 窗口里登录抖音

## 注意事项

- 如果抓取结果为空，通常需要检查是否登录、是否出现验证码、链接是否是作品页。
- 不要尝试绕过验证码；需要用户自己在浏览器里完成登录验证。
