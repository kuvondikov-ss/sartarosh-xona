(() => {
  'use strict';

  // =====================================================================
  // Telegram va yordamchilar
  // =====================================================================
  const tg = window.Telegram?.WebApp;
  const inTg = Boolean(tg?.initData);
  const tgAtLeast = (v) => Boolean(inTg && tg.isVersionAtLeast?.(v));
  if (tg) {
    tg.ready();
    tg.expand();
    try { if (tgAtLeast('7.7')) tg.disableVerticalSwipes(); } catch { /* eski versiya */ }
  }

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const haptic = (kind) => {
    try {
      if (kind === 'select') tg?.HapticFeedback?.selectionChanged();
      else if (kind === 'ok' || kind === 'error') tg?.HapticFeedback?.notificationOccurred(kind === 'ok' ? 'success' : 'error');
      else tg?.HapticFeedback?.impactOccurred('light');
    } catch { /* yo'q */ }
  };

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
  }

  async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (inTg) headers.Authorization = 'tma ' + tg.initData;
    const r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.message || 'Xatolik yuz berdi'), { status: r.status, data });
    return data;
  }

  function openLink(url) {
    if (inTg && /^https:\/\/t\.me\//.test(url)) tg.openTelegramLink(url);
    else if (inTg) tg.openLink(url);
    else window.open(url, '_blank');
  }

  const botLink = (start) => `https://t.me/${state.bot}${start ? `?start=${start}` : ''}`;

  // Telegram CloudStorage (foydalanuvchi qurilmalari orasida) yoki brauzer xotirasi
  const store = {
    get(key) {
      return new Promise((resolve) => {
        const local = () => { try { resolve(localStorage.getItem(key)); } catch { resolve(null); } };
        if (tgAtLeast('6.9') && tg.CloudStorage) {
          tg.CloudStorage.getItem(key, (err, val) => (err || !val ? local() : resolve(val)));
        } else local();
      });
    },
    set(key, val) {
      try { localStorage.setItem(key, val); } catch { /* xotira yopiq */ }
      if (tgAtLeast('6.9') && tg.CloudStorage) tg.CloudStorage.setItem(key, val, () => {});
    },
  };

  // =====================================================================
  // Holat
  // =====================================================================
  const state = {
    bot: '',
    today: '',
    tomorrow: '',
    me: null, // joylashuv { lat, lon }
    barbers: [],
    filter: 'all',
    sort: 'dist',
    query: '',
    selected: null,
    favs: new Set(),
    profile: null,
    sheet: null,
    theme: 'olov',
  };

  const haversineKm = (a, b, c, d) => {
    const r = (x) => (x * Math.PI) / 180;
    const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };
  const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);
  const expText = (y) => (y > 0 ? `${y} yil staj` : '1 yildan kam');
  const byId = (id) => state.barbers.find((b) => b.id === id);

  // =====================================================================
  // Mavzular
  // =====================================================================
  const THEMES = [
    { id: 'olov', name: 'Olov', a: ['#ffa04a', '#ff5a1f'], bg: '#0a1830' },
    { id: 'okean', name: 'Okean', a: ['#3fe3ff', '#2a6dff'], bg: '#062638' },
    { id: 'binafsha', name: 'Binafsha', a: ['#c773ff', '#ff4f9e'], bg: '#1a0e35' },
    { id: 'zumrad', name: 'Zumrad', a: ['#44efa9', '#0ea5a0'], bg: '#062a1f' },
    { id: 'oltin', name: 'Oltin', a: ['#ffdd73', '#e8901a'], bg: '#1e170a' },
    { id: 'tong', name: 'Tong (yorug\')', a: ['#ff9440', '#ff4d2a'], bg: '#f8faff' },
  ];

  function applyTheme(id, save = false) {
    const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
    state.theme = t.id;
    document.documentElement.dataset.theme = t.id;
    try {
      if (tgAtLeast('6.1')) { tg.setHeaderColor(t.bg); tg.setBackgroundColor(t.bg); }
      if (tgAtLeast('7.10')) tg.setBottomBarColor(t.bg);
    } catch { /* eski versiya */ }
    if (save) store.set('theme', t.id);
    renderThemes();
  }

  function renderThemes() {
    $('#themes').innerHTML = THEMES.map((t) => `
      <button class="theme ${t.id === state.theme ? 'active' : ''}" data-theme-id="${t.id}">
        <div class="sw" style="background:${t.bg}; box-shadow: inset 0 0 0 1px rgba(127,127,127,.25)">
          <i style="background:linear-gradient(135deg,${t.a[0]},${t.a[1]})"></i>
          <i style="right:34px;background:${t.a[0]};opacity:.55;width:14px;height:14px;bottom:12px"></i>
        </div>
        <span>${esc(t.name)}</span>
      </button>`).join('');
  }

  // =====================================================================
  // Bo'limlar (pastki menyu)
  // =====================================================================
  function go(tab) {
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab}`));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    window.scrollTo({ top: 0 });
    if (tab === 'bookings') loadMe().then(renderBookings);
    if (tab === 'profile') loadMe().then(renderProfile);
    if (tab === 'search') renderSearch();
    haptic('select');
  }
  $$('.tab').forEach((t) => t.addEventListener('click', () => go(t.dataset.tab)));

  function openSearch(filter) {
    state.filter = filter;
    $$('.chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === filter));
    go('search');
  }

  function scrollToMap() {
    go('home');
    setTimeout(() => $('#mapAnchor').scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    if (!state.me) locate();
  }

  // =====================================================================
  // Reklama banneri — o'zi keyingi slaydga o'tadi
  // =====================================================================
  const PLACEHOLDERS = [
    {
      badge: 'Eng ommabop', title: 'Eng yaqin sartarosh', sub: 'Xaritada toping, 1 daqiqada navbat oling', cta: 'Xaritani ochish', art: 'img/art-pole.webp', action: 'map',
      bg: 'radial-gradient(circle at 78% 45%, #3b3f8f 0%, transparent 55%), linear-gradient(135deg, #0b1838, #1d1346)', glow: 'rgba(255,150,60,.6)',
    },
    {
      badge: 'Yangi', title: 'Tez navbat', sub: "Eng yaqin bo'sh vaqtni o'zimiz topamiz", cta: 'Navbat olish', art: 'img/art-tools.webp', action: 'quick',
      bg: 'radial-gradient(circle at 78% 45%, #0f6a8a 0%, transparent 55%), linear-gradient(135deg, #061a2c, #0b2f4a)', glow: 'rgba(60,220,255,.55)',
    },
    {
      badge: 'Hamkorlik', title: 'Reklamangiz shu yerda', sub: "Minglab mijozlar har kuni ko'radi", cta: "Bog'lanish", art: 'img/art-promo.webp', action: 'bot',
      bg: 'radial-gradient(circle at 78% 45%, #7a2d6e 0%, transparent 55%), linear-gradient(135deg, #1a0b2a, #2a0f33)', glow: 'rgba(255,90,170,.55)',
    },
  ];

  async function initHero() {
    let ads = [];
    try { ads = await api('api/ads'); } catch { /* reklama yo'q */ }
    const slides = ads.length ? ads : PLACEHOLDERS;
    const track = $('#heroTrack');
    const dots = $('#heroDots');

    track.innerHTML = slides.map((a) => {
      if (a.src) {
        const media = a.type === 'video'
          ? `<video class="slide-media" src="${esc(a.src)}" muted playsinline preload="metadata"></video>`
          : `<img class="slide-media" src="${esc(a.src)}" alt="">`;
        return `<div class="slide" data-link="${esc(a.link || '')}">${media}
          ${a.title || a.link ? `<div class="slide-shade"></div><div class="slide-body"><span class="badge-tag">Reklama</span>
          ${a.title ? `<div class="slide-title">${esc(a.title)}</div>` : ''}${a.link ? '<span class="cta">Batafsil →</span>' : ''}</div>` : ''}</div>`;
      }
      return `<div class="slide" data-action="${a.action}" style="background:${a.bg};--art-glow:${a.glow}">
        <img class="slide-art" src="${a.art}" alt="" draggable="false">
        <div class="slide-body"><span class="badge-tag">${esc(a.badge)}</span>
          <div class="slide-title">${esc(a.title)}</div><div class="slide-sub">${esc(a.sub)}</div>
          <span class="cta">${esc(a.cta)} →</span></div></div>`;
    }).join('');
    dots.innerHTML = slides.length > 1 ? slides.map(() => '<i></i>').join('') : '';

    const els = [...track.children];
    let i = 0;
    let timer;
    const show = (n) => {
      els.forEach((el) => el.querySelector('video')?.pause());
      i = (n + els.length) % els.length;
      track.style.transform = `translateX(-${i * 100}%)`;
      [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
      clearTimeout(timer);
      const v = els[i].querySelector('video');
      if (v) {
        v.currentTime = 0;
        v.loop = els.length < 2;
        v.onended = () => show(i + 1);
        v.play().catch(() => {});
        if (els.length > 1) timer = setTimeout(() => show(i + 1), 30000);
      } else if (els.length > 1) {
        timer = setTimeout(() => show(i + 1), 5000);
      }
    };

    let x0 = null;
    const hero = $('#hero');
    hero.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    hero.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 40) { show(i + (dx < 0 ? 1 : -1)); hero.dataset.swiped = '1'; }
    });
    track.addEventListener('click', () => {
      if (hero.dataset.swiped) { delete hero.dataset.swiped; return; }
      const el = els[i];
      if (el.dataset.link) return openLink(el.dataset.link);
      const act = el.dataset.action;
      if (act === 'map') scrollToMap();
      else if (act === 'quick') quickBook();
      else if (act === 'bot' && state.bot) openLink(botLink());
    });
    document.addEventListener('visibilitychange', () => (document.hidden ? clearTimeout(timer) : show(i)));
    show(0);
  }

  // =====================================================================
  // Statistika va xizmatlar
  // =====================================================================
  function renderStats() {
    const open = state.barbers.filter((b) => b.openNow).length;
    const free = state.barbers.reduce((s, b) => s + (b.free || 0), 0);
    $('#stats').innerHTML = `
      <div class="stat"><b class="grad-text">${state.barbers.length}</b><span>sartarosh</span></div>
      <div class="stat"><b>${open}</b><span>hozir ochiq</span></div>
      <div class="stat"><b>${free}</b><span>bo'sh vaqt</span></div>`;
  }

  const SERVICES = [
    { ico: 'img/ic-near.webp', title: 'Yaqin atrofda', sub: "Xaritada ko'rish", tag: () => 'GPS', c: ['#ff9a3d', '#ff4d2e'], act: () => scrollToMap() },
    { ico: 'img/ic-quick.webp', title: 'Tez navbat', sub: "Eng yaqin bo'sh vaqt", tag: () => '1 daqiqa', hot: true, c: ['#3fd5ff', '#2a6dff'], act: () => quickBook() },
    { ico: 'img/ic-open.webp', title: 'Hozir ochiq', sub: 'Jonli holat', tag: () => `${state.barbers.filter((b) => b.openNow).length} ta`, c: ['#2fe08a', '#0ea5a0'], act: () => openSearch('open') },
    { ico: 'img/ic-pro.webp', title: 'Tajribali ustalar', sub: "10 yildan ortiq staj", tag: () => 'PRO', c: ['#c773ff', '#7a4dff'], act: () => openSearch('pro') },
    { ico: 'img/ic-fav.webp', title: 'Sevimlilar', sub: 'Saqlangan ustalar', tag: () => `${state.favs.size}`, c: ['#ff5f9e', '#ff3d5a'], act: () => openSearch('fav') },
    { ico: 'img/ic-cal.webp', title: 'Navbatlarim', sub: 'Holat va bekor qilish', tag: () => `${state.profile?.bookings?.length ?? 0}`, c: ['#ffd56a', '#e8901a'], act: () => go('bookings') },
  ];

  function renderServices() {
    $('#services').innerHTML = SERVICES.map((s, k) => `
      <button class="service" data-service="${k}" style="--c1:${s.c[0]};--c2:${s.c[1]}">
        <img class="ico" src="${s.ico}" alt="" draggable="false">
        <span class="tag ${s.hot ? 'hot' : ''}">${esc(s.tag())}</span>
        <b>${esc(s.title)}</b><small>${esc(s.sub)}</small>
        <span class="go">›</span>
      </button>`).join('');
  }
  $('#services').addEventListener('click', (e) => {
    const el = e.target.closest('[data-service]');
    if (el) { haptic(); SERVICES[Number(el.dataset.service)].act(); }
  });

  // =====================================================================
  // Xarita
  // =====================================================================
  const map = L.map('map', { zoomControl: false }).setView([41.3111, 69.2797], 12); // Toshkent
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  new ResizeObserver(() => map.invalidateSize()).observe($('#map'));
  const markers = new Map();
  let meMarker = null;
  let fitted = false;

  const pinIcon = (b) => L.divIcon({
    className: '',
    html: `<div class="pin ${b.free > 0 ? 'open' : ''} ${state.selected === b.id ? 'sel' : ''}"><span>💈</span></div>`,
    iconSize: [38, 38], iconAnchor: [5, 38], popupAnchor: [14, -36],
  });

  function renderMarkers() {
    const seen = new Set();
    for (const b of state.barbers) {
      seen.add(b.id);
      let m = markers.get(b.id);
      if (!m) {
        m = L.marker([b.lat, b.lon]).addTo(map);
        markers.set(b.id, m);
      }
      m.setLatLng([b.lat, b.lon]).setIcon(pinIcon(b));
      m.bindPopup(`<div class="pop"><b>${esc(b.salon)}</b><small>${esc(b.name)} · ${expText(b.experience)}${b.dist != null ? ' · ' + fmtKm(b.dist) : ''}</small>
        ${statusHtml(b)}<button class="btn primary" style="margin-top:10px;height:36px;width:100%" data-open="${b.id}">Ko'rish va navbat</button></div>`);
    }
    for (const [id, m] of markers) if (!seen.has(id)) { m.remove(); markers.delete(id); }
  }

  function fitView() {
    const pts = (state.me ? state.barbers.slice(0, 5) : state.barbers).map((b) => [b.lat, b.lon]);
    if (state.me) pts.push([state.me.lat, state.me.lon]);
    if (pts.length === 1) map.setView(pts[0], 15);
    else if (pts.length) map.fitBounds(pts, { paddingTopLeft: [30, 50], paddingBottomRight: [30, 30], maxZoom: 16 });
  }

  $('#locateBtn').addEventListener('click', () => (state.me ? map.flyTo([state.me.lat, state.me.lon], 15) : locate()));

  // =====================================================================
  // Joylashuv
  // =====================================================================
  const browserLocation = () => new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });

  const telegramLocation = () => new Promise((resolve) => {
    const lm = tg?.LocationManager;
    if (!tgAtLeast('8.0') || !lm) return resolve(null);
    lm.init(() => {
      if (!lm.isLocationAvailable) return resolve(null);
      lm.getLocation((loc) => resolve(loc ? { lat: loc.latitude, lon: loc.longitude } : null));
    });
  });

  async function locate() {
    $('#locStatus').textContent = 'Joylashuv aniqlanmoqda…';
    const loc = (await telegramLocation()) ?? (await browserLocation());
    if (!loc) {
      $('#locStatus').innerHTML = 'Joylashuv aniqlanmadi · <button id="retryLoc">Qayta</button>';
      $('#retryLoc').addEventListener('click', locate);
      return;
    }
    state.me = loc;
    $('#locStatus').textContent = 'Sizning joylashuvingiz bo\'yicha';
    if (!meMarker) {
      meMarker = L.marker([loc.lat, loc.lon], {
        icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        zIndexOffset: 1000,
      }).addTo(map).bindPopup('Siz shu yerdasiz');
    } else meMarker.setLatLng([loc.lat, loc.lon]);
    applyDistances();
    renderAll();
    fitView();
  }

  // =====================================================================
  // Sartaroshlar ro'yxati
  // =====================================================================
  function statusHtml(b) {
    if (!b.work) return '<span class="status">Vaqt belgilanmagan</span>';
    if (b.free > 0) return `<span class="status ok">${b.work.start}–${b.work.end} · ${b.free} bo'sh</span>`;
    return `<span class="status warn">${b.work.start}–${b.work.end} · band</span>`;
  }

  function cardHtml(b) {
    const thumb = b.photo
      ? `<img class="thumb" src="${esc(b.photo)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=thumb><img src=img/art-pole.webp alt></div>'">`
      : '<div class="thumb"><img src="img/art-pole.webp" alt=""></div>';
    return `<button class="card ${state.selected === b.id ? 'sel' : ''}" data-open="${b.id}">
      ${thumb}
      <div class="card-body">
        <div class="row1"><span class="salon">${esc(b.salon)}</span>${state.favs.has(b.id) ? '<span>❤️</span>' : ''}${b.dist != null ? `<span class="dist">${fmtKm(b.dist)}</span>` : ''}</div>
        <div class="meta">${esc(b.name)} · ${expText(b.experience)}</div>
        ${b.address ? `<div class="meta">📍 ${esc(b.address)}</div>` : ''}
        <div class="row3">${statusHtml(b)}<span class="book-btn">Navbat</span></div>
      </div></button>`;
  }

  const emptyHtml = (icon, title, text = '') => `<div class="empty">${icon.startsWith('img/') ? `<img class="empty-img" src="${icon}" alt="">` : `<span class="big">${icon}</span>`}<b>${esc(title)}</b>${esc(text)}</div>`;

  function applyDistances() {
    for (const b of state.barbers) b.dist = state.me ? haversineKm(state.me.lat, state.me.lon, b.lat, b.lon) : null;
    state.barbers.sort((a, b) => (state.me ? a.dist - b.dist : (b.free > 0) - (a.free > 0) || a.salon.localeCompare(b.salon)));
  }

  function renderHomeList() {
    const el = $('#homeList');
    if (!state.barbers.length) {
      el.innerHTML = emptyHtml('img/art-pole.webp', "Hozircha sartaroshxonalar yo'q", "Sartaroshlar botda ro'yxatdan o'tgach shu yerda ko'rinadi.");
      return;
    }
    el.innerHTML = state.barbers.slice(0, 5).map(cardHtml).join('');
  }

  function renderSearch() {
    const q = state.query.trim().toLowerCase();
    let list = state.barbers.filter((b) => {
      if (state.filter === 'open' && !b.openNow) return false;
      if (state.filter === 'free' && !(b.free > 0)) return false;
      if (state.filter === 'pro' && b.experience < 10) return false;
      if (state.filter === 'fav' && !state.favs.has(b.id)) return false;
      if (q && ![b.salon, b.name, b.address].some((s) => s?.toLowerCase().includes(q))) return false;
      return true;
    });
    const sorters = {
      dist: (a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9),
      free: (a, b) => b.free - a.free,
      exp: (a, b) => b.experience - a.experience,
      name: (a, b) => a.salon.localeCompare(b.salon),
    };
    list = [...list].sort(sorters[state.sort]);
    $('#resultCount').textContent = `${list.length} ta topildi`;
    $('#searchList').innerHTML = list.length
      ? list.map(cardHtml).join('')
      : state.filter === 'fav'
        ? emptyHtml('img/ic-fav.webp', "Sevimlilar bo'sh", "Sartarosh oynasidagi yurakchani bosib saqlang.")
        : emptyHtml('🔎', 'Hech narsa topilmadi', "Boshqa so'z yoki filtrni sinab ko'ring.");
  }

  $('#searchInput').addEventListener('input', (e) => { state.query = e.target.value; renderSearch(); });
  $('#sortSelect').addEventListener('change', (e) => { state.sort = e.target.value; renderSearch(); });
  $$('.chip').forEach((c) => c.addEventListener('click', () => {
    state.filter = c.dataset.filter;
    $$('.chip').forEach((x) => x.classList.toggle('active', x === c));
    haptic('select');
    renderSearch();
  }));

  function renderAll() {
    renderStats();
    renderServices();
    renderMarkers();
    renderHomeList();
    if ($('#view-search').classList.contains('active')) renderSearch();
  }

  async function loadBarbers() {
    try {
      const cfg = await api('api/config');
      Object.assign(state, { bot: cfg.bot, today: cfg.today, tomorrow: cfg.tomorrow });
      state.barbers = await api('api/barbers');
      applyDistances();
      renderAll();
      if (!fitted) { fitView(); fitted = true; }
    } catch {
      $('#homeList').innerHTML = emptyHtml('📡', "Ma'lumot yuklanmadi", 'Internetni tekshirib, qayta oching.');
    }
  }

  // =====================================================================
  // Sartarosh oynasi + navbat olish
  // =====================================================================
  const sheet = $('#sheet');
  const backdrop = $('#backdrop');

  function closeSheet() {
    sheet.classList.remove('on');
    backdrop.classList.remove('on');
    state.sheet = null;
    try { tg?.BackButton?.hide(); } catch { /* yo'q */ }
  }
  backdrop.addEventListener('click', closeSheet);
  tg?.BackButton?.onClick?.(closeSheet);

  function openSheet(id, preferToday = true) {
    const b = byId(id);
    if (!b) return;
    state.selected = id;
    state.sheet = { id, date: preferToday ? state.today : state.tomorrow, time: null };
    renderMarkers();
    const fav = state.favs.has(id);
    sheet.innerHTML = `
      <div class="sheet-cover">${b.photo ? `<img src="${esc(b.photo)}" alt="" onerror="this.remove()">` : '<img class="cover-art" src="img/art-tools.webp" alt="">'}
        <span class="grabber"></span>
        <button class="sheet-fav" data-fav="${id}" aria-label="Sevimli">${fav ? '❤️' : '🤍'}</button>
        <button class="sheet-close" data-close aria-label="Yopish">✕</button>
      </div>
      <div class="sheet-body">
        <h2>${esc(b.salon)}</h2>
        <div class="who">👤 ${esc(b.name)}</div>
        <div class="facts">
          <span class="fact">⭐ ${expText(b.experience)}</span>
          ${b.price ? `<span class="fact">💰 ${esc(b.price)}</span>` : ''}
          <span class="fact">⏱ ${b.slotMinutes} daqiqa</span>
          ${b.dist != null ? `<span class="fact">📍 ${fmtKm(b.dist)}</span>` : ''}
        </div>
        ${b.address ? `<div class="addr">🏠 <span>${esc(b.address)}</span></div>` : ''}
        <div class="actions">
          ${b.phone ? `<a class="act" href="tel:${esc(b.phone)}"><span>📞</span>Qo'ng'iroq</a>` : '<button class="act" disabled style="opacity:.4"><span>📞</span>Qo\'ng\'iroq</button>'}
          <button class="act" data-act="route"><span>🧭</span>Yo'l</button>
          <button class="act" data-act="share"><span>📤</span>Ulashish</button>
          <button class="act" data-act="chat"><span>💬</span>Botda</button>
        </div>
        <div class="daybar">
          <button data-day="${state.today}">Bugun</button>
          <button data-day="${state.tomorrow}">Ertaga</button>
        </div>
        <div class="work-line" id="workLine">Yuklanmoqda…</div>
        <div class="slots" id="slots"></div>
      </div>
      <div class="sheet-cta"><button class="btn primary" id="bookBtn" disabled>Vaqtni tanlang</button></div>`;
    sheet.scrollTop = 0;
    sheet.classList.add('on');
    backdrop.classList.add('on');
    try { tg?.BackButton?.show(); } catch { /* yo'q */ }
    haptic();
    loadSlots();
  }

  async function loadSlots() {
    const s = state.sheet;
    if (!s) return;
    $$('.daybar button', sheet).forEach((x) => x.classList.toggle('on', x.dataset.day === s.date));
    s.time = null;
    updateBookBtn();
    try {
      const d = await api(`api/barber/${s.id}/slots?date=${s.date}`);
      if (state.sheet !== s) return;
      if (!d.work) {
        $('#workLine').textContent = `${d.label}: ish vaqti hali belgilanmagan`;
        $('#slots').innerHTML = `<div style="grid-column:1/-1">${emptyHtml('img/ic-quick.webp', 'Sartarosh hali ishga kelmagan', "U ish vaqtini belgilagach bo'sh vaqtlar shu yerda chiqadi.")}</div>`;
        return;
      }
      const free = d.slots.filter((x) => x.free).length;
      $('#workLine').innerHTML = `${esc(d.label)} · ${d.work.start}–${d.work.end} · <b style="color:var(--ok)">${free} ta bo'sh</b>`;
      $('#slots').innerHTML = d.slots.length
        ? d.slots.map((x) => `<button class="slot ${x.free ? '' : 'busy'}" ${x.free ? `data-time="${x.time}"` : 'disabled'}>${x.time}</button>`).join('')
        : `<div style="grid-column:1/-1">${emptyHtml('😔', "Bo'sh vaqt qolmadi", 'Ertangi kunni tanlab ko\'ring.')}</div>`;
    } catch (e) {
      $('#workLine').textContent = e.message;
    }
  }

  function updateBookBtn() {
    const btn = $('#bookBtn');
    if (!btn) return;
    const t = state.sheet?.time;
    btn.disabled = !t;
    btn.textContent = t ? `Navbat olish · ${t}` : 'Vaqtni tanlang';
  }

  sheet.addEventListener('click', (e) => {
    const s = state.sheet;
    const b = s && byId(s.id);
    const day = e.target.closest('[data-day]');
    if (day && s) { s.date = day.dataset.day; haptic('select'); return loadSlots(); }
    const slot = e.target.closest('[data-time]');
    if (slot && s) {
      s.time = slot.dataset.time;
      $$('.slot', sheet).forEach((x) => x.classList.toggle('on', x === slot));
      haptic('select');
      return updateBookBtn();
    }
    if (e.target.closest('#bookBtn')) return book();
    if (e.target.closest('[data-done-bookings]')) { closeSheet(); return go('bookings'); }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || !b) return;
    if (act === 'route') openLink(`https://yandex.uz/maps/?rtext=~${b.lat},${b.lon}&rtt=auto`);
    if (act === 'chat') openLink(botLink(`b_${b.id}`));
    if (act === 'share') {
      const text = `💈 ${b.salon} — ${b.name}. Shu yerdan navbat oling:`;
      openLink(`https://t.me/share/url?url=${encodeURIComponent(botLink(`b_${b.id}`))}&text=${encodeURIComponent(text)}`);
    }
  });

  async function book() {
    const s = state.sheet;
    const b = s && byId(s.id);
    if (!s?.time || !b) return;
    if (!inTg) {
      toast("Navbat olish uchun ilovani Telegram ichida oching");
      return openLink(botLink(`b_${b.id}`));
    }
    const btn = $('#bookBtn');
    btn.disabled = true;
    btn.textContent = 'Yuborilmoqda…';
    try {
      await api('api/book', { method: 'POST', body: { barberId: b.id, date: s.date, time: s.time } });
      haptic('ok');
      const label = $('#workLine').textContent.split(' · ')[0];
      sheet.innerHTML = `<div class="done">
          <div class="big">✅</div>
          <h2>So'rov yuborildi!</h2>
          <p>💈 ${esc(b.salon)} · ${esc(b.name)}<br>📅 ${esc(label)} · <b>${s.time}</b></p>
          <p style="margin-top:10px">Sartarosh tasdiqlagach Telegram'da darhol xabar keladi.</p>
        </div>
        <div class="sheet-cta" style="display:grid;gap:8px">
          <button class="btn primary" data-done-bookings>Navbatlarimni ko'rish</button>
          <button class="btn" data-close>Yopish</button>
        </div>`;
      loadBarbers();
      loadMe(true);
    } catch (e) {
      haptic('error');
      if (e.data?.code === 'phone') return askPhone(() => book());
      toast(e.message);
      if (e.data?.refresh) loadSlots();
      else updateBookBtn();
    }
  }

  function askPhone(after) {
    const msg = "Navbat olish uchun telefon raqamingizni ulang — sartarosh siz bilan bog'lana olishi uchun.";
    if (tgAtLeast('6.9') && tg.requestContact) {
      tg.requestContact((ok) => {
        if (!ok) { updateBookBtn(); return toast('Raqamsiz navbat olib bo\'lmaydi'); }
        toast('Raqam ulandi ✅');
        setTimeout(() => loadMe(true).then(after), 1500); // bot raqamni saqlashi uchun biroz kutamiz
      });
      return;
    }
    toast(msg);
    openLink(botLink());
  }

  function quickBook() {
    const cand = state.barbers.filter((b) => b.free > 0);
    if (!cand.length) return toast("Hozir bo'sh vaqti bor sartarosh topilmadi");
    cand.sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0) || b.free - a.free);
    openSheet(cand[0].id);
  }

  // =====================================================================
  // Navbatlarim va profil
  // =====================================================================
  let meLoading = null;
  function loadMe(force = false) {
    if (!inTg) return Promise.resolve(null);
    if (meLoading && !force) return meLoading;
    meLoading = api('api/me')
      .then((p) => { state.profile = p; renderCounts(); renderServices(); return p; })
      .catch(() => null);
    return meLoading;
  }

  function renderCounts() {
    const n = state.profile?.bookings?.length ?? 0;
    $('#myCount').textContent = n;
    const badge = $('#tabBadge');
    badge.hidden = !n;
    badge.textContent = n;
  }

  function renderBookings() {
    const el = $('#bookingsList');
    if (!inTg) {
      el.innerHTML = emptyHtml('📱', 'Telegram ichida oching', "Navbatlaringizni ko'rish uchun ilovani bot orqali oching.");
      return;
    }
    const list = state.profile?.bookings ?? [];
    if (!list.length) {
      el.innerHTML = emptyHtml('img/ic-cal.webp', "Faol navbatlar yo'q", "Bosh sahifadan sartarosh tanlab navbat oling.") +
        '<button class="btn primary" style="margin-top:12px;width:100%" data-goto="home">Sartarosh tanlash</button>';
      return;
    }
    el.innerHTML = list.map((k) => `
      <div class="bk">
        <div class="bk-top">
          <div><div class="bk-time">${k.time}</div><div class="bk-date">${esc(k.label)}</div></div>
          ${k.status === 'accepted' ? '<span class="status ok">✅ Tasdiqlangan</span>' : '<span class="status warn">⏳ Kutilmoqda</span>'}
        </div>
        <div class="bk-salon">💈 ${esc(k.salon)}</div>
        <div class="meta">${esc(k.barber)}${k.address ? ' · ' + esc(k.address) : ''}</div>
        <div class="bk-actions">
          ${k.lat != null ? `<button class="btn" data-route="${k.lat},${k.lon}">🧭 Yo'l</button>` : ''}
          ${k.phone ? `<a class="btn" href="tel:${esc(k.phone)}">📞 Qo'ng'iroq</a>` : ''}
          <button class="btn danger" data-cancel="${k.id}">Bekor qilish</button>
        </div>
      </div>`).join('');
  }

  function confirmAsk(text) {
    return new Promise((resolve) => {
      if (tgAtLeast('6.2')) tg.showConfirm(text, resolve);
      else resolve(window.confirm(text));
    });
  }

  async function cancelBooking(id) {
    if (!(await confirmAsk('Navbatni bekor qilasizmi? Sartaroshga xabar boradi.'))) return;
    try {
      await api(`api/me/bookings/${id}/cancel`, { method: 'POST' });
      haptic('ok');
      toast('Navbat bekor qilindi');
      await loadMe(true);
      renderBookings();
      loadBarbers();
    } catch (e) {
      toast(e.message);
    }
  }

  function renderProfile() {
    const u = tg?.initDataUnsafe?.user;
    const p = state.profile;
    const name = u ? [u.first_name, u.last_name].filter(Boolean).join(' ') : 'Mehmon';
    const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    $('#profileCard').innerHTML = `
      <div class="pa">${u?.photo_url ? `<img src="${esc(u.photo_url)}" alt="">` : esc(initials)}</div>
      <h2>${esc(name)}</h2>
      <div class="un">${u?.username ? '@' + esc(u.username) : inTg ? 'Telegram foydalanuvchisi' : "Brauzer orqali ochilgan"}</div>
      <div class="pchips">
        ${p ? `<span class="pchip">${p.hasPhone ? '📞 Raqam ulangan' : '⚠️ Raqam ulanmagan'}</span>` : ''}
        ${p?.isBarber ? '<span class="pchip">💈 Sartarosh</span>' : '<span class="pchip">👤 Mijoz</span>'}
        <span class="pchip">📅 ${p?.bookings?.length ?? 0} faol navbat</span>
        <span class="pchip">❤️ ${state.favs.size} sevimli</span>
      </div>`;

    const items = [];
    if (inTg && p && !p.hasPhone) items.push(['📞', 'Telefon raqamni ulash', 'Navbat olish uchun kerak', 'phone']);
    items.push(['📍', 'Joylashuvni yangilash', state.me ? 'Aniqlangan' : 'Eng yaqinlarni topish uchun', 'locate']);
    items.push(p?.isBarber
      ? ['💈', 'Sartarosh paneli', 'Ish vaqti va navbatlar — botda', 'bot']
      : ['💈', "Sartarosh bo'lib qo'shilish", "Sartaroshxonangizni xaritaga qo'shing", 'barber']);
    items.push(['🤖', 'Botni ochish', `@${state.bot || 'bot'}`, 'bot']);
    $('#profileMenu').innerHTML = items.map(([i, t, s, a]) => `
      <button class="menu-item" data-menu="${a}"><span class="mi">${i}</span><div><b>${esc(t)}</b><small>${esc(s)}</small></div><span>›</span></button>`).join('');
  }

  $('#profileMenu').addEventListener('click', (e) => {
    const a = e.target.closest('[data-menu]')?.dataset.menu;
    if (a === 'phone') askPhone(() => renderProfile());
    if (a === 'locate') locate().then(renderProfile);
    if (a === 'bot') openLink(botLink());
    if (a === 'barber') openLink(botLink('barber'));
  });

  $('#themes').addEventListener('click', (e) => {
    const t = e.target.closest('[data-theme-id]');
    if (t) { applyTheme(t.dataset.themeId, true); haptic('select'); }
  });

  // =====================================================================
  // Umumiy bosishlar
  // =====================================================================
  document.addEventListener('click', (e) => {
    const t = e.target;
    const open = t.closest('[data-open]');
    if (open) { map.closePopup(); return openSheet(Number(open.dataset.open)); }
    const goto = t.closest('[data-goto]');
    if (goto) return go(goto.dataset.goto);
    if (t.closest('[data-close]')) return closeSheet();
    const fav = t.closest('[data-fav]');
    if (fav) {
      const id = Number(fav.dataset.fav);
      if (state.favs.has(id)) state.favs.delete(id); else state.favs.add(id);
      fav.textContent = state.favs.has(id) ? '❤️' : '🤍';
      store.set('favs', JSON.stringify([...state.favs]));
      haptic('select');
      toast(state.favs.has(id) ? "Sevimlilarga qo'shildi" : "Sevimlilardan olindi");
      return renderAll();
    }
    const route = t.closest('[data-route]');
    if (route) return openLink(`https://yandex.uz/maps/?rtext=~${route.dataset.route}&rtt=auto`);
    const cancel = t.closest('[data-cancel]');
    if (cancel) return cancelBooking(Number(cancel.dataset.cancel));
  });

  $('#myBtn').addEventListener('click', () => go('bookings'));
  $('#avatarBtn').addEventListener('click', () => go('profile'));

  // Yuqoridagi avatar
  (() => {
    const u = tg?.initDataUnsafe?.user;
    const el = $('#avatarBtn');
    if (u?.photo_url) el.innerHTML = `<img src="${esc(u.photo_url)}" alt="">`;
    else el.textContent = (u?.first_name?.[0] ?? '👤').toUpperCase();
  })();

  // =====================================================================
  // Ishga tushirish
  // =====================================================================
  (async () => {
    applyTheme(state.theme);
    const [theme, favs] = await Promise.all([store.get('theme'), store.get('favs')]);
    if (theme) applyTheme(theme);
    try { (JSON.parse(favs || '[]')).forEach((id) => state.favs.add(Number(id))); } catch { /* buzilgan */ }
    renderServices();
    initHero();
    await loadBarbers();
    locate();
    loadMe();
    setInterval(loadBarbers, 60000); // bo'sh vaqtlar yangilanib turadi
  })();
})();
