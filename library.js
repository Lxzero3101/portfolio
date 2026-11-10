/* Library page: renders data/steam-library.json merged with data/library-overrides.json. */
(async () => {
  const grid = document.querySelector('[data-games]');
  const filtersEl = document.querySelector('[data-filters]');
  const searchEl = document.querySelector('[data-search]');
  const sortEl = document.querySelector('[data-sort]');
  const STATUSES = ['playing', 'completed', 'dropped', 'played'];

  let games = [];
  let syncedAt = null;
  let state = { filter: 'all', sort: 'recent', q: '' };
  try { Object.assign(state, JSON.parse(sessionStorage.getItem('lib-state') || '{}')); } catch {}

  try {
    const [lib, meta, over] = await Promise.all([
      fetch('data/steam-library.json').then((r) => r.json()),
      fetch('data/steam-sync-meta.json').then((r) => r.json()).catch(() => ({})),
      fetch('data/library-overrides.json').then((r) => r.json()).catch(() => ({ games: {} })),
    ]);
    syncedAt = meta.syncedAt ? new Date(meta.syncedAt) : null;
    const playingMs = SITE.playingWithinDays * 864e5;
    const now = Date.now();
    games = lib
      .map((g) => {
        const o = over.games?.[g.appid] || {};
        const last = g.lastPlayedAt ? new Date(g.lastPlayedAt) : null;
        const recent = last && now - last.getTime() <= playingMs;
        return { ...g, last, status: o.status || (recent ? 'playing' : 'played'), rating: o.rating, note: o.note, hidden: o.hidden };
      })
      .filter((g) => !g.hidden);
  } catch {
    grid.innerHTML = `<div class="px empty" style="grid-column:1/-1">${t('lib.error')}</div>`;
    return;
  }

  const fmtHours = (m) => {
    const h = m / 60;
    return h < 10 ? `${Math.round(h * 10) / 10} h` : `${Math.round(h).toLocaleString()} h`;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function renderStats() {
    const rated = games.filter((g) => g.rating);
    const set = (k, v) => { document.querySelector(`[data-stat="${k}"]`).textContent = v; };
    set('total', games.length);
    set('playing', games.filter((g) => g.status === 'playing').length);
    set('hours', Math.round(games.reduce((s, g) => s + g.playtimeMinutes, 0) / 60).toLocaleString());
    set('rating', rated.length ? (rated.reduce((s, g) => s + g.rating, 0) / rated.length).toFixed(1) : '—');
    document.querySelector('[data-sync]').textContent = syncedAt
      ? syncedAt.toLocaleDateString(getLang() === 'vi' ? 'vi-VN' : 'en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
      : '—';
  }

  function renderFilters() {
    const counts = { all: games.length };
    STATUSES.forEach((s) => { counts[s] = games.filter((g) => g.status === s).length; });
    filtersEl.innerHTML = ['all', ...STATUSES]
      .filter((s) => s === 'all' || counts[s] > 0)
      .map((s) => `<button class="chip" type="button" data-f="${s}" aria-pressed="${state.filter === s}">${t(`lib.f.${s}`)}<span class="n">${counts[s]}</span></button>`)
      .join('');
  }

  function renderGames() {
    const q = state.q.trim().toLowerCase();
    let list = games.filter((g) => (state.filter === 'all' || g.status === state.filter) && (!q || g.name.toLowerCase().includes(q)));
    const byRecent = (a, b) => (b.last?.getTime() || 0) - (a.last?.getTime() || 0);
    const sorters = {
      recent: byRecent,
      playtime: (a, b) => b.playtimeMinutes - a.playtimeMinutes,
      rating: (a, b) => (b.rating || 0) - (a.rating || 0) || byRecent(a, b),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    list.sort(sorters[state.sort] || byRecent);

    if (!list.length) {
      grid.innerHTML = `<div class="px empty" style="grid-column:1/-1">${t('lib.empty')}</div>`;
      return;
    }
    const lang = getLang();
    grid.innerHTML = list.map((g) => {
      const note = g.note?.[lang] || g.note?.en || '';
      const badge = g.status !== 'played' ? `<span class="badge${g.status === 'playing' ? '' : ' dark'}">${t(`lib.f.${g.status}`)}</span>` : '';
      const rating = g.rating ? `<span class="badge dark rating" aria-label="${t('lib.ratingAria', { n: g.rating })}">${g.rating}/10</span>` : '';
      return `<article class="px game">
        <a href="https://store.steampowered.com/app/${g.appid}/" target="_blank" rel="noopener" aria-label="${esc(g.name)}, ${t('lib.openStore')}">
          <div class="cover">
            <img src="${g.cover}" data-fallback="${g.coverFallback}" alt="" loading="lazy" decoding="async">
            ${badge}${rating}
          </div>
          <div class="info">
            <h3 title="${esc(g.name)}">${esc(g.name)}</h3>
            <div class="hours">Steam · ${fmtHours(g.playtimeMinutes)}</div>
            ${note ? `<div class="note">${esc(note)}</div>` : ''}
          </div>
        </a>
      </article>`;
    }).join('');

    // Some games have no portrait cover; fall back to the wide header image.
    grid.querySelectorAll('img[data-fallback]').forEach((img) => {
      const swap = () => {
        if (img.src !== img.dataset.fallback) { img.src = img.dataset.fallback; img.classList.add('wide'); return; }
        img.replaceWith(Object.assign(document.createElement('div'), { className: 'no-cover', textContent: img.closest('.game').querySelector('h3').textContent }));
      };
      img.addEventListener('error', () => img.isConnected && swap());
      if (img.complete && img.naturalWidth === 0) swap();
    });
  }

  const save = () => { try { sessionStorage.setItem('lib-state', JSON.stringify(state)); } catch {} };
  filtersEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    state.filter = b.dataset.f;
    save(); renderFilters(); renderGames();
  });
  sortEl.value = state.sort;
  sortEl.addEventListener('change', () => { state.sort = sortEl.value; save(); renderGames(); });
  searchEl.value = state.q;
  searchEl.addEventListener('input', () => { state.q = searchEl.value; save(); renderGames(); });
  document.addEventListener('langchange', () => { renderStats(); renderFilters(); renderGames(); });

  renderStats(); renderFilters(); renderGames();
})();
