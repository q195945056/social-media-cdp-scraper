# 抖音评论抓取 Codex Skill

这个仓库提供一个 Codex skill：通过带 Chrome DevTools Protocol（CDP）的真实 Chrome 浏览器，抓取抖音作品评论，并导出 JSON 和 CSV 文件。

## 推荐安装方式

在 Codex 里直接对同事说：

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

## 使用方式

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

也可以指定导出目录：

```text
[$douyin-comments-cdp] 抓取这个作品前 1000 条评论，导出到 ./douyin-comments：
https://www.douyin.com/video/...
```

## 使用前准备

- 安装 Chrome
- 安装 Node.js 22 或更高版本
- 第一次使用时，在 CDP Chrome 窗口里登录抖音

## 注意事项

- 这个仓库如果是私有仓库，同事需要先有 GitHub 访问权限。
- 结果是“最多 N 条评论”，抖音可能提前停止返回更多评论。
- 如果抓取结果为 0，通常需要检查是否登录、是否出现验证码、链接是否是作品页。
- 不要尝试绕过验证码；需要用户自己在浏览器里完成验证。
