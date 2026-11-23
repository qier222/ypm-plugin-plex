// Plex Media Server 音乐源插件（YesPlayMusic 3.0）。
// 通过 X-Plex-Token 访问 Plex REST API，支持自动发现音乐库、完整曲库、歌单、评分收藏与歌词。

const t = host.t;
const searchPage = 30;
const libraryPage = 200;

function fail(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function clientId() {
  let id = host.storage.get("clientId");
  if (!id) {
    let hex = "";
    for (let i = 0; i < 16; i++) hex += Math.floor(Math.random() * 16).toString(16);
    id = `ypm-plex-${hex}`;
    host.storage.set("clientId", id);
  }
  return id;
}

function server() {
  const s = String(host.setting("server") || "").trim().replace(/\/+$/, "");
  const token = String(host.setting("token") || "").trim();
  if (!s || !token) {
    throw fail("setup", t("Fill in the server address and X-Plex-Token in the plugin's settings"));
  }
  return /^https?:\/\//i.test(s) ? s : `http://${s}`;
}

function token() {
  const tk = String(host.setting("token") || "").trim();
  if (!tk) {
    throw fail("setup", t("Fill in the server address and X-Plex-Token in the plugin's settings"));
  }
  return tk;
}

function plexHeaders() {
  return {
    Accept: "application/json",
    "X-Plex-Token": token(),
    "X-Plex-Client-Identifier": clientId(),
    "X-Plex-Product": "YesPlayMusic",
    "X-Plex-Version": "0.1.0",
    "X-Plex-Platform": "Desktop",
    // 首页区块的标题由服务器按这个语言给（「更多 Billie Eilish 的作品」）
    "X-Plex-Language": host.language() || "en",
  };
}

// Plex 的过滤写成 `userRating>=8`。参数名写 `userRating>`：URLSearchParams 会编码成
// `userRating%3E=8`，Plex 认；写成 `userRating>=` 的话 `=` 也被编码，Plex 就忽略这个过滤。
function buildUrl(path, params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    q.set(k, String(v));
  }
  const qs = q.toString();
  return `${server()}${path}${qs ? `?${qs}` : ""}`;
}

async function api(path, { method = "GET", params = {}, expectJson = true } = {}) {
  let res;
  try {
    res = await fetch(buildUrl(path, params), { method, headers: plexHeaders() });
  } catch (e) {
    if (e.code) throw e;
    throw new Error(`${t("Can't reach the server")}: ${e.message || e}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw fail("signIn", t("Invalid X-Plex-Token"));
  }
  if (res.status === 404) {
    throw fail("unavailable", `${path}: HTTP 404`);
  }
  if (!res.ok) {
    throw new Error(`${path}: HTTP ${res.status}`);
  }
  if (!expectJson || res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw fail("setup", t("That address doesn't answer as a Plex server"));
  }
  return body?.MediaContainer || body;
}

// ── 服务器信息与音乐库发现 ──

let metaCache = null;

function metaKey() {
  return [
    String(host.setting("server") || "").trim(),
    String(host.setting("token") || "").trim(),
    String(host.setting("section") || "").trim(),
  ].join("\n");
}

async function getServerMeta() {
  const key = metaKey();
  if (metaCache && metaCache.key === key) return metaCache;

  const [root, sectionsRes] = await Promise.all([
    api("/"),
    api("/library/sections"),
  ]);
  const dirs = Array.isArray(sectionsRes?.Directory) ? sectionsRes.Directory : [];
  const musicLibs = dirs.filter((d) => d.type === "artist");
  if (!musicLibs.length) {
    throw fail("setup", t("No music library found on this Plex server"));
  }

  const wanted = String(host.setting("section") || "").trim();
  let lib = musicLibs[0];
  if (wanted) {
    lib = musicLibs.find(
      (d) => String(d.key) === wanted || (d.title || "").toLowerCase() === wanted.toLowerCase()
    ) || musicLibs[0];
  }

  metaCache = {
    key,
    machineId: String(root?.machineIdentifier || ""),
    friendlyName: root?.friendlyName || "Plex",
    username: root?.myPlexUsername || "",
    sectionId: String(lib.key),
  };
  return metaCache;
}

// ── 数据结构映射 ──

function img(path, size = 600) {
  if (!path) return "";
  const q = new URLSearchParams({
    width: String(size),
    height: String(size),
    minSize: "1",
    upscale: "1",
    url: String(path),
    "X-Plex-Token": token(),
  });
  return `${server()}/photo/:/transcode?${q}`;
}

function isoTime(sec) {
  if (!sec) return "";
  try {
    return new Date(Number(sec) * 1000).toISOString();
  } catch {
    return "";
  }
}

function trackOf(item) {
  const artistName = item.originalTitle || item.grandparentTitle || "";
  const artistId = item.grandparentRatingKey ? String(item.grandparentRatingKey) : "";
  const albumId = item.parentRatingKey ? String(item.parentRatingKey) : "";
  const cover = img(item.parentThumb || item.thumb);
  return {
    id: String(item.ratingKey),
    name: item.title || "",
    artists: artistName ? [{ id: artistId, name: artistName }] : [],
    album: albumId || item.parentTitle
      ? { id: albumId, name: item.parentTitle || "", imageUrl: cover }
      : undefined,
    duration: Number(item.duration) || 0,
    added: isoTime(item.addedAt),
  };
}

function albumOf(item) {
  return {
    id: String(item.ratingKey),
    name: item.title || "",
    imageUrl: img(item.thumb),
    artists: item.parentTitle
      ? [{ id: String(item.parentRatingKey || ""), name: item.parentTitle }]
      : [],
    released: item.originallyAvailableAt || (item.year ? String(item.year) : ""),
    trackCount: item.leafCount || undefined,
    saved: (item.userRating || 0) >= 8,
    added: isoTime(item.addedAt),
  };
}

function artistOf(item) {
  return {
    id: String(item.ratingKey),
    name: item.title || "",
    imageUrl: img(item.thumb),
    following: (item.userRating || 0) >= 8,
  };
}

function playlistOf(item) {
  return {
    id: String(item.ratingKey),
    name: item.title || "",
    imageUrl: img(item.composite || item.thumb),
    description: item.summary || "",
    trackCount: item.leafCount || 0,
    mine: !item.smart,
    fixed: !!item.smart,
    saved: true,
  };
}

const list = (x) => (Array.isArray(x) ? x : x ? [x] : []);

// ── 账号 ──

export async function account() {
  if (!host.setting("server") || !host.setting("token")) return null;
  const meta = await getServerMeta();
  return {
    id: meta.machineId || "plex",
    name: meta.username || meta.friendlyName,
    imageUrl: "",
  };
}

// ── 首页与搜索 ──

// 首页：直接用服务器编排好的音乐库首页（/hubs/sections），标题跟着听歌记录变
// （更多某歌手的作品、某流派、某厂牌、本月常听、很久没听……）。电台放在最上面。
export async function home() {
  const { sectionId } = await getServerMeta();
  const soft = (p) => p.catch((e) => (e.code === "signIn" || e.code === "setup" ? Promise.reject(e) : null));
  const [hubs, lists] = await Promise.all([
    api(`/hubs/sections/${sectionId}`, { params: { includeStations: 1, count: 18 } }),
    soft(api("/playlists", { params: { playlistType: "audio" } })),
  ]);

  const modes = [];
  const sections = [];
  for (const h of list(hubs?.Hub)) {
    const items = list(h.Metadata);
    if (!items.length) continue;
    const title = h.title || "";
    switch (h.type) {
      case "station":
        for (const x of items) {
          if (x.key) modes.push({ title: x.title || "", subtitle: stationNote(x.guid), station: String(x.key) });
        }
        break;
      case "album":
        sections.push({ style: "shelf", title, albums: items.map(albumOf) });
        break;
      case "artist":
        sections.push({ style: "shelf", title, artists: items.map(artistOf) });
        break;
      case "track":
        sections.push({ style: "songs", title, tracks: items.map(trackOf) });
        break;
      case "playlist":
        sections.push({ style: "shelf", title, playlists: items.map(playlistOf) });
        break;
      // 音乐视频（clip）这类放不了的不显示
    }
  }
  // 老服务器没有电台：自己做一个随机漫游
  if (!modes.length) {
    modes.push({ title: t("Shuffle the library"), subtitle: t("Anything from your library"), station: "shuffle" });
  }
  const playlists = list(lists?.Metadata).map(playlistOf);
  return {
    sections: [
      // 只要顶部两张大卡片
      { style: "modes", modes: modes.slice(0, 2) },
      ...sections,
      ...(playlists.length ? [{ style: "shelf", title: t("Playlists"), playlists }] : []),
    ],
  };
}

// 电台标题已经写了「电台」，副标题说它放什么
function stationNote(guid) {
  const kind = String(guid || "").split("/").pop();
  const notes = {
    library: "Anything from your library",
    "deep-cuts": "Songs you rarely play",
    history: "Through the years, in order",
    album: "One random album after another",
  };
  return notes[kind] ? t(notes[kind]) : "";
}

// 电台：Plex 的电台（/library/sections/<id>/stations/<n>）每次建一个新的播放队列，
// 取里面的歌；shuffle 是整个曲库随机。
export async function station({ id }) {
  const { sectionId, machineId } = await getServerMeta();
  if (id === "shuffle") {
    const mc = await api(`/library/sections/${sectionId}/all`, {
      params: { type: 10, sort: "random", "X-Plex-Container-Start": 0, "X-Plex-Container-Size": 30 },
    });
    return { tracks: list(mc?.Metadata).map(trackOf), more: true };
  }
  if (!String(id).startsWith("/library/")) throw fail("unsupported", id);
  const mc = await api("/playQueues", {
    method: "POST",
    params: {
      type: "audio",
      uri: `server://${machineId}/com.plexapp.plugins.library${id}`,
      repeat: 0,
      shuffle: 0,
    },
  });
  const tracks = list(mc?.Metadata).filter((x) => x.type === "track").map(trackOf);
  return { tracks, more: tracks.length > 0 };
}

export async function search({ query, kind = "tracks", offset = 0 }) {
  const { sectionId } = await getServerMeta();
  const q = String(query || "").trim();
  if (!q) return {};

  if (kind === "playlists") {
    if (offset) return { playlists: [], more: false };
    const mc = await api("/playlists", { params: { playlistType: "audio" } });
    const lower = q.toLowerCase();
    const found = list(mc?.Metadata)
      .filter((p) => (p.title || "").toLowerCase().includes(lower))
      .map(playlistOf);
    return { playlists: found, more: false };
  }

  const typeMap = { artists: 8, albums: 9, tracks: 10 };
  const type = typeMap[kind];
  if (!type) return {};

  const mc = await api(`/library/sections/${sectionId}/all`, {
    params: {
      type,
      title: q,
      "X-Plex-Container-Start": offset,
      "X-Plex-Container-Size": searchPage,
    },
  });
  const items = list(mc?.Metadata);
  const total = mc?.totalSize ?? (offset + items.length);
  const more = offset + items.length < total;
  if (kind === "tracks") return { tracks: items.map(trackOf), more, total };
  if (kind === "albums") return { albums: items.map(albumOf), more, total };
  return { artists: items.map(artistOf), more, total };
}

// ── 完整曲库 ──

export async function library({ kind, offset = 0 }) {
  const { sectionId } = await getServerMeta();
  if (kind === "playlists") {
    if (offset) return { playlists: [], more: false };
    const mc = await api("/playlists", { params: { playlistType: "audio" } });
    return { playlists: list(mc?.Metadata).map(playlistOf), more: false };
  }

  const typeMap = { artists: 8, albums: 9, tracks: 10 };
  const type = typeMap[kind];
  if (!type) return {};

  const mc = await api(`/library/sections/${sectionId}/all`, {
    params: {
      type,
      sort: "titleSort:asc",
      "X-Plex-Container-Start": offset,
      "X-Plex-Container-Size": libraryPage,
    },
  });
  const items = list(mc?.Metadata);
  const total = mc?.totalSize ?? (offset + items.length);
  const more = offset + items.length < total;
  if (kind === "tracks") return { tracks: items.map(trackOf), more, total };
  if (kind === "albums") return { albums: items.map(albumOf), more, total };
  return { artists: items.map(artistOf), more, total };
}

// ── 专辑与艺人 ──

export async function album({ id }) {
  const [infoMc, childrenMc] = await Promise.all([
    api(`/library/metadata/${encodeURIComponent(id)}`),
    api(`/library/metadata/${encodeURIComponent(id)}/children`),
  ]);
  const info = list(infoMc?.Metadata)[0] || { ratingKey: id };
  return {
    album: albumOf(info),
    tracks: list(childrenMc?.Metadata).map(trackOf),
  };
}

export async function artist({ id }) {
  const { sectionId } = await getServerMeta();
  const [infoMc, albumsMc, tracksMc, relatedMc] = await Promise.all([
    api(`/library/metadata/${encodeURIComponent(id)}`),
    api(`/library/metadata/${encodeURIComponent(id)}/children`),
    api(`/library/sections/${sectionId}/all`, {
      params: {
        type: 10,
        "artist.id": id,
        sort: "viewCount:desc",
        "X-Plex-Container-Start": 0,
        "X-Plex-Container-Size": 30,
      },
    }).catch(() => ({ Metadata: [] })),
    api(`/library/metadata/${encodeURIComponent(id)}/similar`, {
      params: { "X-Plex-Container-Start": 0, "X-Plex-Container-Size": 12 },
    }).catch(() => ({ Metadata: [] })),
  ]);

  const info = list(infoMc?.Metadata)[0] || { ratingKey: id };
  const albums = list(albumsMc?.Metadata)
    .map(albumOf)
    .sort((x, y) => (y.released || "").localeCompare(x.released || ""));
  const out = artistOf(info);
  if (!out.imageUrl && albums[0]) out.imageUrl = albums[0].imageUrl;
  return {
    artist: out,
    tracks: list(tracksMc?.Metadata).map(trackOf),
    albums,
    related: list(relatedMc?.Metadata).map(artistOf),
  };
}

// ── 歌单 ──

export async function playlists() {
  const mc = await api("/playlists", { params: { playlistType: "audio" } });
  return list(mc?.Metadata).map(playlistOf);
}

export async function playlist({ id }) {
  const [infoMc, itemsMc] = await Promise.all([
    api(`/playlists/${encodeURIComponent(id)}`),
    api(`/playlists/${encodeURIComponent(id)}/items`),
  ]);
  const info = list(infoMc?.Metadata)[0] || { ratingKey: id };
  return {
    ...playlistOf(info),
    tracks: list(itemsMc?.Metadata).map(trackOf),
  };
}

export async function createPlaylist({ name }) {
  const { machineId } = await getServerMeta();
  const mc = await api("/playlists", {
    method: "POST",
    params: {
      type: "audio",
      title: name,
      smart: 0,
      uri: machineId ? `server://${machineId}/com.plexapp.plugins.library/library/metadata/` : "",
    },
  });
  const created = list(mc?.Metadata)[0];
  return created ? playlistOf(created) : { id: "", name, mine: true, saved: true };
}

export async function renamePlaylist({ id, name }) {
  await api(`/playlists/${encodeURIComponent(id)}`, {
    method: "PUT",
    params: { title: name },
    expectJson: false,
  });
}

export async function deletePlaylist({ id }) {
  await api(`/playlists/${encodeURIComponent(id)}`, {
    method: "DELETE",
    expectJson: false,
  });
}

export async function addToPlaylist({ id, trackIds }) {
  if (!trackIds?.length) return;
  const { machineId } = await getServerMeta();
  const uri = `server://${machineId}/com.plexapp.plugins.library/library/metadata/${trackIds.join(",")}`;
  await api(`/playlists/${encodeURIComponent(id)}/items`, {
    method: "PUT",
    params: { uri },
    expectJson: false,
  });
}

export async function removeFromPlaylist({ id, trackIds }) {
  if (!trackIds?.length) return;
  const mc = await api(`/playlists/${encodeURIComponent(id)}/items`);
  const drop = new Set(trackIds.map(String));
  const itemIds = list(mc?.Metadata)
    .filter((m) => drop.has(String(m.ratingKey)) && m.playlistItemID !== undefined)
    .map((m) => String(m.playlistItemID));
  for (const itemId of itemIds) {
    await api(`/playlists/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`, {
      method: "DELETE",
      expectJson: false,
    });
  }
}

export async function movePlaylistTrack({ id, from, to }) {
  const mc = await api(`/playlists/${encodeURIComponent(id)}/items`);
  const items = list(mc?.Metadata);
  const item = items[from];
  if (!item || item.playlistItemID === undefined || from === to) return;
  // Plex 只能「挪到某一项后面」：先拿掉自己，再找新位置前面那一项；挪到最前面时不带 after
  const rest = items.filter((_, i) => i !== from);
  const after = to > 0 ? rest[Math.min(to, rest.length) - 1] : null;
  await api(`/playlists/${encodeURIComponent(id)}/items/${encodeURIComponent(item.playlistItemID)}/move`, {
    method: "PUT",
    params: after ? { after: after.playlistItemID } : {},
    expectJson: false,
  });
}

// ── 喜欢、收藏与历史（使用 Plex 5 星评分表示喜欢/收藏）──

export async function liked({ offset = 0 } = {}) {
  const { sectionId } = await getServerMeta();
  const limit = 100;
  const mc = await api(`/library/sections/${sectionId}/all`, {
    params: {
      type: 10,
      "userRating>": 8,
      sort: "titleSort:asc",
      "X-Plex-Container-Start": offset,
      "X-Plex-Container-Size": limit,
    },
  });
  const items = list(mc?.Metadata);
  const total = mc?.totalSize ?? (offset + items.length);
  return { tracks: items.map(trackOf), more: offset + items.length < total };
}

export async function isLiked({ ids }) {
  if (!ids?.length) return {};
  const mc = await api(`/library/metadata/${ids.map(encodeURIComponent).join(",")}`);
  const map = {};
  for (const item of list(mc?.Metadata)) {
    map[String(item.ratingKey)] = (item.userRating || 0) >= 8;
  }
  return Object.fromEntries(ids.map((id) => [id, !!map[String(id)]]));
}

async function setRate(id, on) {
  await api("/:/rate", {
    method: "PUT",
    params: {
      key: id,
      identifier: "com.plexapp.plugins.library",
      rating: on ? 10 : -1,
    },
    expectJson: false,
  });
}

export const like = ({ id, on }) => setRate(id, on);
export const saveAlbum = ({ id, on }) => setRate(id, on);
export const followArtist = ({ id, on }) => setRate(id, on);

export async function savedAlbums({ offset = 0 } = {}) {
  const { sectionId } = await getServerMeta();
  const limit = 100;
  const mc = await api(`/library/sections/${sectionId}/all`, {
    params: {
      type: 9,
      "userRating>": 8,
      sort: "titleSort:asc",
      "X-Plex-Container-Start": offset,
      "X-Plex-Container-Size": limit,
    },
  });
  const items = list(mc?.Metadata);
  const total = mc?.totalSize ?? (offset + items.length);
  return { albums: items.map(albumOf), more: offset + items.length < total };
}

export async function recent() {
  const { sectionId } = await getServerMeta();
  const mc = await api(`/library/sections/${sectionId}/all`, {
    params: {
      type: 10,
      sort: "lastViewedAt:desc",
      "viewCount>": 1,
      "X-Plex-Container-Start": 0,
      "X-Plex-Container-Size": 50,
    },
  });
  return list(mc?.Metadata).map(trackOf);
}

export async function similar({ id }) {
  let mc;
  try {
    mc = await api(`/library/metadata/${encodeURIComponent(id)}/similar`, {
      params: { "X-Plex-Container-Start": 0, "X-Plex-Container-Size": 20 },
    });
  } catch (e) {
    // 服务器没做音频分析（没有 Plex Pass 或还没分析完）时是 404，当作没有相似歌曲
    if (e.code === "unavailable") return [];
    throw e;
  }
  return list(mc?.Metadata).map(trackOf);
}

// ── 播放与歌词 ──

export async function stream({ id, quality = "high" }) {
  const headers = plexHeaders();
  if (quality === "standard") {
    const url = buildUrl("/music/:/transcode/universal/start.mp3", {
      path: `/library/metadata/${id}`,
      mediaIndex: 0,
      partIndex: 0,
      protocol: "http",
      maxAudioBitrate: 192,
      "X-Plex-Token": token(),
      "X-Plex-Client-Identifier": clientId(),
    });
    return { url, type: "mp3", quality, headers };
  }

  const mc = await api(`/library/metadata/${encodeURIComponent(id)}`);
  const meta = list(mc?.Metadata)[0];
  const media = list(meta?.Media)[0];
  const part = list(media?.Part)[0];
  if (!part?.key) {
    throw fail("unavailable", t("No playable audio stream found"));
  }
  const url = buildUrl(part.key, { download: 0, "X-Plex-Token": token() });
  return {
    url,
    type: media?.container || media?.audioCodec || "",
    quality,
    bitRate: media?.bitrate ? Number(media.bitrate) * 1000 : undefined,
    size: part?.size ? Number(part.size) : undefined,
    headers,
  };
}

export async function played({ id }) {
  await api("/:/scrobble", {
    params: { key: id, identifier: "com.plexapp.plugins.library" },
    expectJson: false,
  });
}

export async function lyrics({ id }) {
  try {
    const mc = await api(`/library/metadata/${encodeURIComponent(id)}`);
    const meta = list(mc?.Metadata)[0];
    const part = list(list(meta?.Media)[0]?.Part)[0];
    const streams = list(part?.Stream);
    const lrcStream = streams.find((s) => s.streamType === 4 && s.format === "lrc" && s.key)
      || streams.find((s) => s.streamType === 4 && s.key);
    if (!lrcStream?.key) return {};

    const res = await fetch(buildUrl(lrcStream.key, { "X-Plex-Token": token() }), {
      headers: { "X-Plex-Token": token() },
    });
    if (!res.ok) return {};
    const text = await res.text();
    if (!text.trim()) return {};
    if (lrcStream.format === "lrc" || /\[\d{1,2}:\d{2}/.test(text)) {
      return { lrc: text };
    }
    return { lines: text.split(/\r?\n/).map((line) => ({ start: 0, text: line })) };
  } catch (e) {
    if (e.code === "signIn" || e.code === "setup") throw e;
    return {};
  }
}
