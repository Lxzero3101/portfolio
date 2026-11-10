// Sync the Steam games I have played into data/steam-library.json.
//
// Two modes:
//   1. Web API (used by GitHub Actions): needs STEAM_API_KEY. Calls IPlayerService/GetOwnedGames.
//   2. Local Steam client (no key): reads userdata/<accountId>/config/localconfig.vdf on this PC
//      and looks up names via the public Steam store API. Handy for the very first seed.
//
// Usage:  node scripts/sync-steam.mjs
// Env:    STEAM_API_KEY (optional), STEAM_ID (SteamID64, defaults to mine below)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

if (existsSync('.env') && typeof process.loadEnvFile === 'function') process.loadEnvFile('.env');

const LIBRARY_FILE = 'data/steam-library.json';
const META_FILE = 'data/steam-sync-meta.json';
const CDN = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps';
const DEFAULT_STEAM_ID = '76561199030107081'; // steamcommunity.com/id/lxzero
const STEAM_ID64_BASE = 76561197960265728n;

// Tools / runtimes that are not games.
const EXCLUDED_APPIDS = new Set([228980, 431960, 250820, 1070560, 1391110, 1628350]);

const apiKey = process.env.STEAM_API_KEY?.trim();
const steamId = (process.env.STEAM_ID || DEFAULT_STEAM_ID).trim();

function parseVdf(text) {
  const tokens = [];
  const re = /"((?:\\.|[^"\\])*)"|([{}])/g;
  let m;
  while ((m = re.exec(text))) tokens.push(m[2] ? { brace: m[2] } : { str: m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') });
  let i = 0;
  const readObj = () => {
    const obj = {};
    while (i < tokens.length) {
      const t = tokens[i++];
      if (t.brace === '}') return obj;
      if (t.str === undefined) continue;
      const next = tokens[i++];
      if (!next) break;
      if (next.brace === '{') obj[t.str] = readObj();
      else if (next.str !== undefined) obj[t.str] = next.str;
    }
    return obj;
  };
  return readObj();
}

// Case-insensitive key lookup for VDF objects.
const pick = (o, k) => (o ? o[Object.keys(o).find((x) => x.toLowerCase() === k.toLowerCase())] : undefined);

function findLocalSteamPath() {
  const candidates = ['c:/Program Files (x86)/Steam', 'c:/Program Files/Steam', 'd:/steam', 'e:/steam'];
  try {
    const out = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const match = out.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    if (match) candidates.unshift(match[1].trim());
  } catch {}
  return candidates.find((p) => existsSync(join(p, 'userdata')));
}

async function fetchViaApi() {
  const url = new URL('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/');
  url.search = new URLSearchParams({
    key: apiKey,
    steamid: steamId,
    include_appinfo: '1',
    include_played_free_games: '1',
    format: 'json',
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Steam API request failed: HTTP ${res.status}`);
  const games = (await res.json())?.response?.games;
  if (!Array.isArray(games)) throw new Error('Steam API returned no games. Is "Game details" set to Public on your Steam profile?');
  return games.map((g) => ({
    appid: Number(g.appid),
    name: g.name,
    playtimeMinutes: g.playtime_forever ?? 0,
    lastPlayed: g.rtime_last_played ?? 0,
  }));
}

async function fetchViaLocalSteam() {
  const steamPath = findLocalSteamPath();
  if (!steamPath) throw new Error('No STEAM_API_KEY set and no local Steam client found.');
  const accountId = String(BigInt(steamId) - STEAM_ID64_BASE);
  const vdfPath = join(steamPath, 'userdata', accountId, 'config', 'localconfig.vdf');
  if (!existsSync(vdfPath)) throw new Error(`Local Steam config not found: ${vdfPath}`);
  console.log(`Reading local Steam data: ${vdfPath}`);

  const vdf = parseVdf(readFileSync(vdfPath, 'utf8'));
  const apps = pick(pick(pick(pick(pick(vdf, 'UserLocalConfigStore'), 'Software'), 'Valve'), 'Steam'), 'apps') ?? {};

  const known = new Map();
  if (existsSync(LIBRARY_FILE)) {
    try { for (const g of JSON.parse(readFileSync(LIBRARY_FILE, 'utf8'))) known.set(g.appid, g.name); } catch {}
  }

  const out = [];
  for (const [id, info] of Object.entries(apps)) {
    if (!/^\d+$/.test(id) || typeof info !== 'object') continue;
    const playtimeMinutes = Number(pick(info, 'Playtime') ?? 0);
    if (playtimeMinutes <= 0) continue;
    const appid = Number(id);
    let name = known.get(appid);
    if (!name) {
      try {
        const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`);
        const entry = res.ok ? (await res.json())?.[id] : null;
        if (entry?.success && entry.data?.type === 'game') name = entry.data.name;
      } catch {}
    }
    if (name) out.push({ appid, name, playtimeMinutes, lastPlayed: Number(pick(info, 'LastPlayed') ?? 0) });
  }
  return out;
}

const raw = apiKey ? await fetchViaApi() : await fetchViaLocalSteam();

const library = raw
  .filter((g) => !EXCLUDED_APPIDS.has(g.appid) && g.playtimeMinutes > 0)
  .map((g) => ({
    appid: g.appid,
    name: g.name,
    cover: `${CDN}/${g.appid}/library_600x900.jpg`,
    coverFallback: `${CDN}/${g.appid}/header.jpg`,
    playtimeMinutes: g.playtimeMinutes,
    lastPlayedAt: g.lastPlayed ? new Date(g.lastPlayed * 1000).toISOString() : null,
  }))
  .sort((a, b) => a.appid - b.appid);

const next = `${JSON.stringify(library, null, 2)}\n`;
const prev = existsSync(LIBRARY_FILE) ? readFileSync(LIBRARY_FILE, 'utf8') : '';
if (next === prev) {
  console.log(`No changes (${library.length} games).`);
} else {
  writeFileSync(LIBRARY_FILE, next);
  // Only bump the sync time when data changed, so the daily job doesn't make empty commits.
  writeFileSync(META_FILE, `${JSON.stringify({ syncedAt: new Date().toISOString() }, null, 2)}\n`);
  console.log(`Updated ${library.length} games.`);
}
