# Viet Phi Long Le — portfolio

Static site (plain HTML/CSS/JS, no build step) hosted on GitHub Pages. The **Library** page lists the Steam games I've played and is refreshed automatically once a day by GitHub Actions.

## Pages

| File | What it is |
|---|---|
| `index.html` | Home: intro, stats, skills, experience, education, contact |
| `works.html` | Bomb Slime + game jams and prototypes |
| `library.html` + `library.js` | Steam library (filters, search, sort) |
| `blog.html` | Blog, **hidden for now** (see below) |
| `i18n.js` | Vietnamese text. English text lives directly in the HTML. |
| `script.js` | Theme toggle, language toggle, icons, site switches |
| `styles.css` | All styles. Colours are CSS variables at the top (light + dark). |

## Preview locally

```bash
node scripts/dev-server.mjs
```

Then open http://localhost:5173.

## Publish on GitHub Pages (one-time setup)

https://lxzero3101.github.io/portfolio/

1. Create a repo on github.com/Lxzero3101, e.g. `portfolio` (or `Lxzero3101.github.io` for a root URL), and push this folder to the `main` branch.
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Get a Steam Web API key at https://steamcommunity.com/dev/apikey (any domain name works).
4. Repo **Settings → Secrets and variables → Actions → New repository secret**: name `STEAM_API_KEY`, value = your key.
5. Make sure your Steam profile **Privacy → Game details** is **Public**.
6. **Actions → "Sync Steam & deploy" → Run workflow** once to test.

After that, the workflow runs every day (14:00 UTC, around midnight Sydney time), commits any changes to `data/steam-library.json` and redeploys. It also deploys on every push to `main`.

Your SteamID64 (`76561199030107081`) is already set. To change it, add a repo **variable** named `STEAM_ID`.

## Updating the Steam library by hand

Without an API key, the script reads your local Steam client's play data:

```bash
node scripts/sync-steam.mjs
```

With a key, put `STEAM_API_KEY=...` in a `.env` file (it's git-ignored) and run the same command.

## Rating or tagging games

Edit `data/library-overrides.json`, keyed by Steam appid (the number in the store URL):

```json
{
  "games": {
    "413150": { "status": "completed", "rating": 8, "note": { "en": "Cosy.", "vi": "Thư giãn." } },
    "1234":   { "hidden": true }
  }
}
```

Status is one of `playing`, `completed`, `dropped`, `played`. Without an override, games played in the last 14 days show as **Playing** (change `playingWithinDays` in `script.js`).

## Turning on the blog

1. Write a post as an HTML page, e.g. `blog/my-first-post.html` (copy the header/footer from `blog.html`).
2. Add it to `data/posts.json`:
   ```json
   [{ "url": "blog/my-first-post.html", "date": "2026-12-01",
      "title": { "en": "My first devlog", "vi": "Nhật ký đầu tiên" },
      "summary": { "en": "…", "vi": "…" } }]
   ```
3. In `script.js`, set `showBlog: true`. The nav link and the home card appear.
4. In `blog.html`, delete the `<meta name="robots" content="noindex">` line.
