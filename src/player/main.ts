// Lecteur web SYNK : pour les écrans qui n'ont pas Android (Samsung pro via « URL Launcher », navigateurs).
// Mêmes règles que le lecteur Android : connexion par QR code, relevé à la minute (programmation),
// playlist vidéos + images (20 s), bascule sans écran noir, cache, veille hors horaires, commandes.
// Sécurité : seule la clé limitée des TV est utilisée ici (jamais la clé de l'app d'administration).

import qrcode from 'qrcode-generator';
import './player.css';

/* ------------------------------ Réglages ------------------------------ */

const SB_URL = 'https://qterhrrgommazueinntd.supabase.co';
// Clé « anon » : la même que celle des TV Android (accès limité).
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF0ZXJocnJnb21tYXp1ZWlubnRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODMxMDcsImV4cCI6MjA5MjQ1OTEwN30.zhakjk_ulmIyrGbKAnTfaZrkBQD43S9HMh74su76dYU';
const VERSION = 'Web 1.0';
const IMAGE_MS = 20_000;
const HEALTH_EVERY_MS = 30 * 60_000;
const CACHE = 'synk-media';
const COLUMNS = 'pos_x,pos_y,total_cols,total_rows,video_url,opening_time,closing_time,command,command_id,rotation';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

interface ScreenRow {
  pos_x: number;
  pos_y: number;
  total_cols: number;
  total_rows: number;
  video_url: string | null;
  opening_time: string | null;
  closing_time: string | null;
  command: string | null;
  command_id: string | null;
  rotation: number | null;
}

const app = document.getElementById('synk') as HTMLDivElement;
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(`synk.${k}`);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(`synk.${k}`);
      else localStorage.setItem(`synk.${k}`, v);
    } catch {
      /* stockage indisponible : le lecteur fonctionne quand même */
    }
  },
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/* ------------------------------ Réseau ------------------------------ */

/** Écart avec l'heure du serveur (l'horloge des écrans est souvent fausse). */
let clockOffset = 0;
const now = () => Date.now() + clockOffset;
const exchanges: { at: number; ok: boolean; ms: number }[] = [];

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const start = Date.now();
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
      ...init,
      cache: 'no-store',
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    const date = res.headers.get('date');
    if (date) clockOffset = Date.parse(date) + 500 - Date.now();
    exchanges.push({ at: Date.now(), ok: res.status < 500, ms: Date.now() - start });
    return res;
  } catch (err) {
    exchanges.push({ at: Date.now(), ok: false, ms: Date.now() - start });
    throw err;
  } finally {
    while (exchanges.length && Date.now() - exchanges[0].at > 3600_000) exchanges.shift();
  }
}

const iso = () => new Date(now()).toISOString();
const patchScreen = (id: string, fields: Record<string, unknown>) =>
  rest(`screens_config?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(fields) }).catch(() => undefined);

const deviceModel = () => {
  const ua = navigator.userAgent;
  const tizen = ua.match(/Tizen\s*([\d.]+)/i)?.[1];
  if (tizen) return `Samsung · Tizen ${tizen}`;
  if (/Web0S|webOS/i.test(ua)) return 'LG · webOS';
  return `Navigateur · ${navigator.platform || 'web'}`;
};

/* ------------------------------ Logo ------------------------------ */

const LOGO = (() => {
  const tiles = [
    [4, 4],
    [52, 4],
    [4, 52],
    [52, 52],
  ]
    .map(([x, y]) => `<rect x="${x}" y="${y}" width="44" height="44" rx="11" fill="url(#g)"/>`)
    .join('');
  const clip = [
    [4, 4],
    [52, 4],
    [4, 52],
    [52, 52],
  ]
    .map(([x, y]) => `<rect x="${x}" y="${y}" width="44" height="44" rx="11"/>`)
    .join('');
  const letters = [
    'M 52 27 C 47 19.5, 38 18.5, 31.5 18.5 C 20 18.5, 13 25, 13 33.5 C 13 42, 20 45.5, 31 48.5 C 43 51.5, 52 55, 52 65.5 C 52 75, 44.5 81.5, 32 81.5 C 24 81.5, 15.5 79, 11.5 72.5',
    'M 79 18.5 L 100 55 M 121 18.5 L 100 55 L 100 81.5',
    'M 147 81.5 L 147 18.5 L 189 81.5 L 189 18.5',
    'M 217 18.5 L 217 81.5 M 259 18.5 L 219 58 M 224 53 L 261 81.5',
  ]
    .map(d => `<path d="${d}"/>`)
    .join('');
  return (cls: string) => `<svg class="${cls}" viewBox="0 0 398 100" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a3d"/><stop offset="1" stop-color="#e85a0c"/></linearGradient>
    <clipPath id="c">${clip}</clipPath>
    <mask id="m" maskUnits="userSpaceOnUse" x="-10" y="0" width="294" height="100"><rect x="-10" width="294" height="100" fill="#fff"/><rect x="-10" y="47.5" width="294" height="4" fill="#000"/></mask></defs>
    ${tiles}
    <g clip-path="url(#c)" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round"><path d="M 25.3 42.0 A 26 26 0 0 1 70.5 34.0"/><path d="M 74.7 58.0 A 26 26 0 0 1 29.5 66.0"/></g>
    <g clip-path="url(#c)" fill="#fff"><path d="M 77.2 28.8 L 76.6 41.9 L 63.8 39.2 Z"/><path d="M 22.8 71.2 L 23.4 58.1 L 36.2 60.8 Z"/></g>
    <g transform="translate(124 0)" mask="url(#m)" fill="none" stroke="#fff" stroke-width="17" stroke-linecap="round" stroke-linejoin="round">${letters}</g>
  </svg>`;
})();

/* ------------------------------ Connexion par QR code ------------------------------ */

function pairingCode(): string {
  const saved = store.get('pairing_code');
  if (saved && saved.length === 6) return saved;
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const code = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
  store.set('pairing_code', code);
  return code;
}

function qrSvg(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="#000"/></svg>`;
}

async function runPairing() {
  const code = pairingCode();
  const id = `TV-${code}`;
  const url = `${location.origin}/?tv=${code}`;
  app.innerHTML = `${LOGO('logo-small')}
    <div class="pair">
      <div class="col">
        <span class="eyebrow">NOUVEL ÉCRAN</span>
        <h1>Connectez<br>cet écran</h1>
        <span class="hint">Scannez le QR code avec votre téléphone</span>
        <span class="label">OU SAISISSEZ CE CODE DANS SYNK</span>
        <div class="code">${code
          .split('')
          .map((ch, i) => `<span class="${i === 3 ? 'gap' : ''}">${ch}</span>`)
          .join('')}</div>
        <div class="status"><span class="dot"></span><span class="txt">En attente</span></div>
      </div>
      <div class="qr">${qrSvg(url)}</div>
    </div>`;
  const dot = app.querySelector('.dot') as HTMLElement;
  const txt = app.querySelector('.txt') as HTMLElement;
  const setOnline = (on: boolean) => {
    dot.classList.toggle('off', !on);
    txt.textContent = on ? 'En attente' : 'Pas de connexion internet';
  };

  let registered = false;
  for (let tick = 0; ; tick++) {
    try {
      if (!registered) {
        const res = await rest('screens_config', {
          method: 'POST',
          headers: { Prefer: 'resolution=ignore-duplicates' },
          body: JSON.stringify({ id, pos_x: 0, pos_y: 0, total_cols: 1, total_rows: 1 }),
        });
        registered = res.ok;
        if (registered) await patchScreen(id, { booted_at: iso(), player_version: VERSION, device_model: deviceModel() });
      }
      const res = await rest(`screens_config?id=eq.${id}&select=command`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as { command: string | null }[];
      setOnline(true);
      if (rows.length === 0) registered = false;
      else if ((rows[0].command || '').startsWith('adopt:')) {
        const name = (rows[0].command || '').slice(6).trim();
        if (name) {
          store.set('screen_id', name);
          store.set('pairing_code', null);
          await rest(`screens_config?id=eq.${id}`, { method: 'DELETE' }).catch(() => undefined);
          const pair = app.querySelector('.pair') as HTMLElement;
          pair.innerHTML = `<div class="done"><div class="check">✓</div><b>Connecté</b><small></small></div>`;
          (pair.querySelector('small') as HTMLElement).textContent = name;
          await sleep(2400);
          location.reload();
          return;
        }
      }
      if (registered && tick % 6 === 0) await patchScreen(id, { last_ping: iso() });
    } catch {
      setOnline(false);
    }
    await sleep(3000);
  }
}

/* ------------------------------ Cache des médias ------------------------------ */

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const isImage = (url: string) => IMAGE_EXT.test(url.split('#')[0].split('?')[0]);
const normalize = (url: string) =>
  url.includes('dropbox.com') && !url.includes('raw=1') ? `${url.replace(/[?&]dl=0/, '')}${url.includes('?') ? '&' : '?'}raw=1` : url;

const usage = () => {
  try {
    return JSON.parse(store.get('media_used') || '{}') as Record<string, number>;
  } catch {
    return {};
  }
};

/** Média prêt à jouer : depuis le cache de l'écran, sinon téléchargé et mis en cache (sinon lien direct). */
async function playable(url: string): Promise<string> {
  const src = normalize(url);
  try {
    const cache = await caches.open(CACHE);
    let res = await cache.match(src);
    if (!res) {
      const net = await fetch(src, { mode: 'cors' });
      if (!net.ok) throw new Error(`HTTP ${net.status}`);
      await cache.put(src, net.clone()).catch(() => undefined);
      res = net;
    }
    return URL.createObjectURL(await res.blob());
  } catch {
    return src; // pas de cache possible (CORS, quota) : lecture directe
  }
}

/** Médias gardés 8 jours après leur dernière diffusion (les créneaux reviennent chaque semaine). */
async function pruneCache(inUse: string[]) {
  const used = usage();
  const t = Date.now();
  inUse.forEach(u => (used[normalize(u)] = t));
  try {
    const cache = await caches.open(CACHE);
    for (const req of await cache.keys()) {
      const last = used[req.url] ?? 0;
      if (t - last > 8 * 24 * 3600_000) {
        await cache.delete(req);
        delete used[req.url];
      }
    }
  } catch {
    /* pas de cache : rien à nettoyer */
  }
  store.set('media_used', JSON.stringify(used));
}

/* ------------------------------ Lecture ------------------------------ */

const stage = document.createElement('div');
stage.className = 'stage';
const layers = [document.createElement('div'), document.createElement('div')];
layers.forEach(l => {
  l.className = 'layer';
  stage.appendChild(l);
});
const notice = document.createElement('div');
notice.className = 'notice';

let playlist: string[] = []; // URLs d'origine
let sources: string[] = []; // URLs jouables (cache)
let playlistKey = '';
let index = 0;
let front = 0;
let advanceTimer: ReturnType<typeof setTimeout> | undefined;
let asleep = false;
let playState = 'idle';

function showNotice(text: string | null) {
  if (text === null) {
    notice.classList.add('hidden');
    return;
  }
  notice.innerHTML = `${LOGO('logo')}<p></p>`;
  (notice.querySelector('p') as HTMLElement).textContent = text;
  notice.classList.remove('hidden');
}

function makeElement(i: number): HTMLElement {
  const url = sources[i];
  if (isImage(playlist[i])) {
    const img = document.createElement('img');
    img.src = url;
    return img;
  }
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.loop = sources.length === 1; // vidéo seule : boucle sans coupure
  v.src = url;
  return v;
}

function clearLayer(layer: HTMLElement) {
  const v = layer.querySelector('video');
  if (v) {
    v.pause();
    v.removeAttribute('src');
    v.load();
  }
  layer.innerHTML = '';
}

/** Affiche l'élément i sur la couche de devant, prépare le suivant derrière. */
function showItem(i: number) {
  clearTimeout(advanceTimer);
  if (asleep || sources.length === 0) return;
  index = i % sources.length;
  const back = 1 - front;
  const layer = layers[back];
  // L'élément a peut-être déjà été préparé derrière.
  let el = layer.firstElementChild as HTMLElement | null;
  if (!el || el.dataset.i !== String(index)) {
    clearLayer(layer);
    el = makeElement(index);
    el.dataset.i = String(index);
    layer.appendChild(el);
  }
  const next = () => showItem(index + 1);
  if (el instanceof HTMLVideoElement) {
    const v = el;
    v.onended = sources.length > 1 ? next : null;
    v.onerror = () => {
      playState = 'error';
      advanceTimer = setTimeout(next, 1000);
    };
    v.currentTime = 0;
    v.play().catch(() => undefined);
  } else {
    advanceTimer = setTimeout(next, IMAGE_MS);
  }
  layers[back].classList.add('on');
  layers[front].classList.remove('on');
  const old = front;
  front = back;
  playState = 'playing';
  // L'ancienne couche est vidée après le fondu, puis reçoit le suivant (préchargé).
  setTimeout(() => {
    if (front === old) return;
    clearLayer(layers[old]);
    if (sources.length > 1) {
      const ni = (index + 1) % sources.length;
      const pre = makeElement(ni);
      pre.dataset.i = String(ni);
      if (pre instanceof HTMLVideoElement) pre.pause();
      layers[old].appendChild(pre);
    }
  }, 600);
}

/** Nouvelle playlist : tout est préparé pendant que l'ancienne continue, puis bascule d'un coup. */
async function applyPlaylist(raw: string | null) {
  const urls = (raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const key = urls.join(',');
  if (key === playlistKey) return;
  playlistKey = key;
  if (urls.length === 0) {
    playlist = [];
    sources = [];
    layers.forEach(clearLayer);
    showNotice('Aucun contenu programmé');
    return;
  }
  if (sources.length === 0) showNotice('Chargement…');
  const ready = await Promise.all(urls.map(playable));
  if (playlistKey !== key) {
    ready.forEach(u => u.startsWith('blob:') && URL.revokeObjectURL(u));
    return; // une autre playlist est arrivée entre-temps
  }
  const previous = sources;
  playlist = urls;
  sources = ready;
  store.set('last_playlist', key);
  pruneCache(urls);
  layers.forEach(clearLayer);
  showNotice(null);
  showItem(0);
  setTimeout(() => previous.forEach(u => u.startsWith('blob:') && URL.revokeObjectURL(u)), 2000);
}

/* ------------------------------ Horaires ------------------------------ */

const minutesParis = () => {
  const parts = new Date(now()).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour12: false }).split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
};
const toMin = (t: string | null | undefined, fallback: number) => {
  if (!t) return fallback;
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
function isOpen(row: Pick<ScreenRow, 'opening_time' | 'closing_time'>) {
  const open = toMin(row.opening_time, 0);
  const close = toMin(row.closing_time, 1439);
  const m = minutesParis();
  return open <= close ? m >= open && m < close : m >= open || m < close;
}

function setAsleep(id: string, sleep: boolean) {
  if (asleep === sleep) return;
  asleep = sleep;
  patchScreen(id, { power_state: sleep ? 'sleep' : 'on', power_state_at: iso() });
  if (sleep) {
    clearTimeout(advanceTimer);
    layers.forEach(clearLayer);
    layers.forEach(l => l.classList.remove('on'));
    notice.innerHTML = '';
    notice.classList.remove('hidden'); // écran noir (les écrans Samsung gardent leur propre minuterie marche/arrêt)
    playState = 'sleep';
  } else {
    showNotice(null);
    if (sources.length) showItem(0);
  }
}

/* ------------------------------ Lecteur connecté ------------------------------ */

function layout(row: ScreenRow) {
  const cols = Math.max(1, row.total_cols || 1);
  const rows = Math.max(1, row.total_rows || 1);
  // Mur : chaque écran affiche sa part de l'image (pas de synchronisation entre écrans web).
  stage.style.width = `${cols * 100}vw`;
  stage.style.height = `${rows * 100}vh`;
  stage.style.transform = `translate(${-(row.pos_x || 0) * 100}vw, ${-(row.pos_y || 0) * 100}vh)`;
  app.classList.toggle('flipped', row.rotation === 180);
}

function identify(id: string, row: ScreenRow | null) {
  const el = document.createElement('div');
  el.className = 'identify';
  const multi = row && (row.total_cols > 1 || row.total_rows > 1);
  el.innerHTML = `${multi ? `<b>${row.pos_y * row.total_cols + row.pos_x + 1}</b>` : ''}<span></span>`;
  (el.querySelector('span') as HTMLElement).textContent = id;
  app.appendChild(el);
  setTimeout(() => el.remove(), 12_000);
}

async function handleCommand(id: string, row: ScreenRow): Promise<boolean> {
  if (!row.command_id || store.get('last_command_id') === row.command_id) return false;
  store.set('last_command_id', row.command_id);
  await patchScreen(id, { command_ack: row.command_id, command_ack_at: iso() });
  switch (row.command) {
    case 'reload':
      location.reload();
      return true;
    case 'clear_cache':
      await caches.delete(CACHE).catch(() => undefined);
      store.set('media_used', null);
      location.reload();
      return true;
    case 'unpair':
      await caches.delete(CACHE).catch(() => undefined);
      ['screen_id', 'last_playlist', 'last_hours', 'media_used'].forEach(k => store.set(k, null));
      location.reload();
      return true;
    case 'identify':
      identify(id, row);
      return false;
    case 'health':
      lastHealth = 0;
      return false;
    default:
      return false; // commandes propres au lecteur Android : ignorées
  }
}

let lastHealth = 0;
async function sendHealth(id: string) {
  lastHealth = Date.now();
  const list = exchanges.slice();
  const okTimes = list.filter(e => e.ok).map(e => e.ms).sort((a, b) => a - b);
  const conn = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number } }).connection;
  const health: Record<string, unknown> = {
    v: 1,
    web: true,
    net: 'other',
    valid: navigator.onLine,
    play: playState,
    res: `${screen.width}x${screen.height}`,
    up: Math.round(performance.now() / 60_000),
    at: new Date(now()).toISOString().replace(/\.\d+Z$/, 'Z'),
  };
  if (list.length) {
    health.ok = Math.round((list.filter(e => e.ok).length * 100) / list.length);
    health.n = list.length;
  }
  if (okTimes.length) health.lat = okTimes[Math.floor(okTimes.length / 2)];
  if (conn?.downlink) health.down = Math.round(conn.downlink);
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota) health.disk = Math.round(((est.quota || 0) - (est.usage || 0)) / 1048576);
    if (est?.usage) health.cache = Math.round(est.usage / 1048576);
  } catch {
    /* estimation indisponible */
  }
  await patchScreen(id, { last_ping: iso(), health });
}

async function runPlayer(id: string) {
  app.appendChild(stage);
  app.appendChild(notice);
  showNotice('Démarrage…');

  // Démarrage hors ligne : dernière playlist et horaires connus.
  try {
    const hours = JSON.parse(store.get('last_hours') || 'null') as Pick<ScreenRow, 'opening_time' | 'closing_time'> | null;
    if (hours && !isOpen(hours)) setAsleep(id, true);
  } catch {
    /* rien de mémorisé */
  }
  if (!asleep && store.get('last_playlist')) applyPlaylist(store.get('last_playlist'));

  await patchScreen(id, { booted_at: iso(), player_version: VERSION, device_model: deviceModel() });

  let row: ScreenRow | null = null;
  let viaPoll = true;
  let lastPing = 0;
  for (;;) {
    try {
      let res: Response;
      if (viaPoll) {
        // Une seule requête : configuration + signal de vie.
        res = await rest(`rpc/screen_poll?select=${COLUMNS}`, { method: 'POST', body: JSON.stringify({ p_id: id }) });
        if (res.status === 404) {
          viaPoll = false;
          continue;
        }
      } else {
        res = await rest(`screens_config?id=eq.${encodeURIComponent(id)}&select=${COLUMNS}`);
        if (Date.now() - lastPing > 180_000) {
          lastPing = Date.now();
          patchScreen(id, { last_ping: iso() });
        }
      }
      if (res.ok) {
        const rows = (await res.json()) as ScreenRow[];
        if (rows.length === 0) {
          // Écran supprimé dans SYNK : retour à la connexion par QR code.
          store.set('screen_id', null);
          location.reload();
          return;
        }
        row = rows[0];
        if (!(await handleCommand(id, row))) {
          layout(row);
          store.set('last_hours', JSON.stringify({ opening_time: row.opening_time, closing_time: row.closing_time }));
          const open = isOpen(row);
          setAsleep(id, !open);
          if (open) await applyPlaylist(row.video_url);
        }
      }
    } catch {
      /* hors ligne : on continue avec ce qui est en cache */
    }
    if (Date.now() - lastHealth > HEALTH_EVERY_MS) sendHealth(id);
    // Rechargement quotidien à 4 h (mémoire du navigateur), seulement fermé.
    if (asleep && minutesParis() === 240 && performance.now() > 3600_000) location.reload();
    if (asleep) {
      // Veille : relevé toutes les 5 min, mais l'heure d'ouverture est vérifiée ici toutes les 30 s
      // (avec les derniers horaires reçus) pour se réveiller à l'heure pile, même sans internet.
      for (let k = 0; k < 10; k++) {
        await sleep(30_000);
        if (row && isOpen(row)) break;
      }
    } else {
      // Relevé suivant 5 s après la minute (le programmateur change les playlists à la minute pile).
      const t = now();
      await sleep(Math.min(65_000, Math.max(5_000, (Math.floor(t / 60_000) + 1) * 60_000 + 5_000 - t)));
    }
  }
}

/* ------------------------------ Démarrage ------------------------------ */

// Erreur imprévue : on redémarre proprement plutôt que de rester figé.
window.addEventListener('error', () => setTimeout(() => location.reload(), 30_000));

const screenId = store.get('screen_id');
if (screenId) runPlayer(screenId);
else runPairing();
