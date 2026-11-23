# Plex for YesPlayMusic

English · [简体中文](README.zh-CN.md)

Official Plex Media Server music source plugin for [YesPlayMusic](https://github.com/qier222/YesPlayMusic) 3.0.

## Installation

- **Option 1 (Recommended)**: Open YesPlayMusic → **Settings → Plugins → Official Plugins**, then install **Plex**.
- **Option 2**: Open **Settings → Plugins → Install Plugin** and paste `github.com/qier222/ypm-plugin-plex`.

## Configuration

1. Open **Settings → Plugins → Plex → ⋯ → Plugin Settings…** and fill in:
   - **Server address**: e.g. `http://127.0.0.1:32400`
   - **X-Plex-Token**: in Plex Web, open any item's **Get Info → View XML** and copy `X-Plex-Token` from the URL
   - **Music library name or ID (optional)**: specify a library if you have multiple, or leave blank to use the first one
2. Switch the active music source to **Plex**.

## Features

- Home: Recently Added, Recently Played, Most Played, Playlists, library shuffle, and recommendations
- Full library browsing (tracks, albums, artists, playlists) and search
- Album, artist, and playlist pages with playlist creation, renaming, deletion, and track management
- Liked tracks, saved albums, followed artists (synced via Plex 5-star ratings), and play history
- Direct playback (High / Lossless) or 192 kbps MP3 transcoding (Standard), with playback reporting
- Plex lyrics streams (`.lrc` / `.txt`) and similar tracks
- Multi-language support

## License

[MIT](LICENSE)
