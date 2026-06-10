# Douyin Comments CDP Skill

This repository contains a Codex skill for exporting comments from Douyin works through a real Chrome browser connected by Chrome DevTools Protocol.

## Install

Copy the skill directory into your Codex skills folder:

```bash
mkdir -p ~/.codex/skills
cp -R douyin-comments-cdp ~/.codex/skills/
```

Restart Codex after copying.

## Use

In Codex, call the skill by name:

```text
[$douyin-comments-cdp] 抓取这个抖音作品前 500 条评论：https://www.douyin.com/video/...
```

For multiple works:

```text
[$douyin-comments-cdp] 抓取这些作品评论，每个最多 300 条：
https://www.douyin.com/video/...
https://www.douyin.com/video/...
```

## Requirements

- Chrome
- Node.js 22+
- Douyin login in the CDP Chrome profile on first use

The skill writes JSON and CSV files to the output directory selected during scraping.
