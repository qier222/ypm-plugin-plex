# Plex for YesPlayMusic

[English](README.md) · 简体中文

[YesPlayMusic](https://github.com/qier222/YesPlayMusic) 3.0 官方 Plex Media Server 音乐源插件。

## 安装

- **方式一（推荐）**：打开 YesPlayMusic → **设置 → 插件 → 官方插件**，找到 **Plex** 点击安装。
- **方式二**：打开 **设置 → 插件 → 安装插件**，粘贴 `github.com/qier222/ypm-plugin-plex`。

## 配置

1. 在 **设置 → 插件 → Plex → ⋯ → 插件设置…** 中填写：
   - **服务器地址**：例如 `http://127.0.0.1:32400`
   - **X-Plex-Token**：在 Plex 网页版任意媒体条目点「获取信息 → 查看 XML」，地址栏末尾的 `X-Plex-Token` 即是
   - **音乐库名称或 ID（可选）**：有多个音乐库时可指定，留空默认使用第一个音乐库
2. 在「音乐来源」里切换到 **Plex** 即可使用。

## 功能

- 首页：最近添加、最近播放、最常播放、歌单、随机漫游与推荐
- 完整曲库浏览（歌曲、专辑、艺人、歌单）与搜索
- 专辑、艺人、歌单详情页，支持创建、重命名、删除歌单以及增删歌曲
- 喜欢歌曲、收藏专辑、关注艺人（以 Plex 5 星评分同步）与最近播放
- 原码直出（高音质 / 无损）或 192 kbps MP3 转码（标准音质），自动上报播放记录
- 读取 Plex 歌词流（`.lrc` / `.txt`）与相似歌曲
- 多语言界面支持

## 协议

[MIT](LICENSE)
