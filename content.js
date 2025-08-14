
(() => {
  // ====== SETTINGS & KEYS ======
  const K = {
    enabled: 'rzEnabled',
    enableRating: 'rzEnableRating',
    ratingMin: 'rzRatingMin',
    ratingMax: 'rzRatingMax',
    enableReviews: 'rzEnableReviews',
    reviewsMin: 'rzReviewsMin',
    reviewsMax: 'rzReviewsMax',
    hideNoReviews: 'rzHideNoReviews',
    enablePrice: 'rzEnablePrice',
    priceMin: 'rzPriceMin',
    priceMax: 'rzPriceMax',
    enableTopOnly: 'rzEnableTopOnly',
  };
  let settings = {
    enabled: true,
    enableRating: false, ratingMin: null, ratingMax: null,
    enableReviews: false, reviewsMin: null, reviewsMax: null,
    hideNoReviews: false,
    enablePrice: false, priceMin: null, priceMax: null,
    enableTopOnly: false,
  };

  let observer = null, heartbeatTimer = null;
  const HIDE_CLASS = 'rz-hidden';

  // ====== STYLES ======
  const style = document.createElement('style');
  style.textContent = `
    .${HIDE_CLASS}{ display:none !important; }

    /* Portal floating button */
    .rz-analytics-fab{ position:absolute; z-index:2147483646; display:none; }
    .rz-analytics-fab button{ appearance:none; border:1px solid #e5e7eb; background:#0ea5e9; color:#fff; border-radius:10px; padding:6px 10px; font-size:12px; cursor:pointer; box-shadow:0 4px 16px rgba(0,0,0,.18); }
    .rz-analytics-fab.show{ display:block; }

    /* Portal panel */
    .rz-analytics-portal{ position:absolute; z-index:2147483647; background:#f9fafb; border:1px solid #e5e7eb; border-radius:10px; padding:8px; box-shadow:0 8px 26px rgba(0,0,0,.18); width:min(460px, calc(100vw - 24px)); }
    .rz-analytics-portal table{ width:100%; border-collapse:collapse; }
    .rz-analytics-portal th, .rz-analytics-portal td{ text-align:left; padding:4px 6px; border-bottom:1px dashed #e5e7eb; font-size:12px; }
    .rz-analytics-portal tr:last-child td{ border-bottom:none; }
    .rz-analytics-portal .rz-analytics-error{ color:#dc2626; }
    .rz-analytics-portal .rz-analytics-close{ position:absolute; top:6px; right:8px; border:none; background:transparent; cursor:pointer; font-size:14px; }
    .rz-analytics-portal .rz-analytics-title{ font-weight:600; margin-bottom:6px; }
    .rz-analytics-portal .rz-analytics-loading{ display:flex; align-items:center; gap:8px; }
    .rz-analytics-portal .rz-analytics-loading::before{ content:""; width:16px; height:16px; border:2px solid #e5e7eb; border-top-color:#0ea5e9; border-radius:50%; animation: rzspin .8s linear infinite; }
    @keyframes rzspin{ to { transform: rotate(360deg); } }
  `;
  document.documentElement.appendChild(style);

  // ====== UTILS ======
  const toNum = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

  function loadSettings(cb) {
    const defaults = {}; for (const [k,v] of Object.entries(settings)) defaults[K[k]] = v;
    chrome.storage.sync.get(defaults, (res) => {
      const out = {}; for (const [k, keyName] of Object.entries(K)) out[k] = res[keyName];
      ['ratingMin','ratingMax','reviewsMin','reviewsMax','priceMin','priceMax'].forEach(k => out[k] = toNum(out[k]));
      settings = { ...settings, ...out };
      cb && cb();
    });
  }

  function parseIntSafe(s){ const n=parseInt(s,10); return Number.isNaN(n)?null:n; }

  // Find a good root element to hide (grid cell or tile wrapper)
  function getGridCell(node) {
    return node.closest('li.catalog-grid__cell, .catalog-grid__cell') ||
           node.closest('div.item') ||
           node.closest('rz-catalog-tile, app-goods-tile-default, rz-product-tile') ||
           node.closest('.goods-tile, .product-card') ||
           node;
  }

  // Scope inside cell for data extraction
  function getCardScope(cell) {
    return cell.querySelector('.goods-tile__inner, .goods-tile, .content, .tile, .tile-image-host, .tile-title, .price-wrap') || cell;
  }

  // ---- Extractors ----
  function extractRatingFromStars(scope) {
    const el = scope.querySelector('[data-testid="stars-rating"].stars__rating, .stars__rating[data-testid="stars-rating"], [data-testid="stars-rating"]');
    if (!el) return null;
    const styleAttr = el.getAttribute('style') || '';
    let m = styleAttr.match(/calc\(\s*(\d+(?:\.\d+)?)%\s*[-+]/i); if (!m) m = styleAttr.match(/(\d+(?:\.\d+)?)%/i);
    if (!m) return null;
    const pct=parseFloat(m[1]); if (Number.isNaN(pct)) return null;
    return Math.round((Math.max(0, Math.min(5, pct / 20))) * 100) / 100;
  }

  function extractReviewCount(scope) {
    // Typical: <span class="rating-block-content"><svg ... icon-review> 3 </span>
    const iconUse = scope.querySelector('use[rziconname="icon-review"], use[rzIconName="icon-review"], use[href*="#icon-review" i]');
    if (iconUse) {
      const container = iconUse.closest('.rating-block-content') || iconUse.parentElement;
      if (container) {
        const text=(container.textContent||'').replace(/\s+/g,' ').trim();
        const m=text.match(/(\d{1,6})\b/); if (m) return parseIntSafe(m[1]);
      }
    }
    // Fallbacks
    const rbList=scope.querySelectorAll('.rating-block-content, [class*="rating-block"]');
    for (const rb of rbList) {
      const text=(rb.textContent||'').replace(/\s+/g,' ').trim();
      const m=text.match(/(?:^|\D)(\d{1,6})(?:\D|$)/); if (m) return parseIntSafe(m[1]);
    }
    const starsWrap = scope.querySelector('[data-testid="stars-rating"], .stars__rating');
    if (starsWrap) {
      const t=(starsWrap.parentElement?.textContent||'').trim();
      const m=t.match(/\((\d+)\)/); if (m) return parseIntSafe(m[1]);
    }
    return null;
  }

  function hasExplicitNoReviews(scope) {
    const nodes = scope.querySelectorAll('a, span, div, button');
    for (const el of nodes) {
      const t=(el.textContent||'').toLowerCase(); if (!t) continue;
      if (t.includes('оставить отзыв')||t.includes('залишити відгук')||t.includes('відгуків ще немає')||t.includes('будьте першим')) return true;
    }
    return false;
  }

  function extractPrice(scope) {
    // pick lowest non-old price
    const candidates = scope.querySelectorAll(
      '.goods-tile__price-value, .price.color-red, [class*="price__value"], [class*="price-value"], .goods-tile__price, .price'
    );
    let best=null;
    for (const el of candidates) {
      const cls=(el.className||'').toString();
      if (/old|strike|line-through|old-price|price--old/i.test(cls)) continue;
      const text=(el.textContent||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
      const digits=text.replace(/[^\d]/g,''); if (!digits) continue;
      const val=parseIntSafe(digits); if (val===null) continue;
      if (best===null || val<best) best=val;
    }
    return best;
  }

  function hasTopSales(scope) {
    const byClass = scope.querySelector('.promo-label_type_popularity, [class*="promo-label_type_popularity"]');
    if (byClass) return true;
    const labels = scope.querySelectorAll('.goods-tile__label, .promo-label, [class*="label"]');
    for (const el of labels) {
      let t=(el.textContent||'').toLowerCase(); if (!t) continue;
      t=t.replace(/\u00a0/g,' ').replace(/\s+/g,'').trim();
      if (t.includes('топродаж')||t.includes('топродажів')||t.includes('топпродажей')) return true;
    }
    return false;
  }

  // ---- Compose info ----
  function getInfo(cell) {
    const scope = getCardScope(cell);
    const rating=extractRatingFromStars(scope);
    const count=extractReviewCount(scope);
    const price=extractPrice(scope);
    const top=hasTopSales(scope);
    let hasReviews=null;
    if (count!==null) hasReviews = count>0; else if (hasExplicitNoReviews(scope)) hasReviews=false;
    return { rating, count, price, top, hasReviews };
  }

  // ---- Decide hide ----
  function mustHide(info) {
    if (!settings.enabled) return false;
    let hide=false;
    if (settings.enableTopOnly && !info.top) hide=true;
    if (settings.hideNoReviews && info.hasReviews===false) hide=true;
    if (settings.enableRating && info.rating!==null) {
      if (settings.ratingMin!==null && info.rating<settings.ratingMin) hide=true;
      if (settings.ratingMax!==null && info.rating>settings.ratingMax) hide=true;
    }
    if (settings.enableReviews && info.count!==null) {
      if (settings.reviewsMin!==null && info.count<settings.reviewsMin) hide=true;
      if (settings.reviewsMax!==null && info.count>settings.reviewsMax) hide=true;
    }
    if (settings.enablePrice && info.price!==null) {
      if (settings.priceMin!==null && info.price<settings.priceMin) hide=true;
      if (settings.priceMax!==null && info.price>settings.priceMax) hide=true;
    }
    return hide;
  }

  // ---- Iterate tiles (sitewide) ----
  function eachTileCell(cb) {
    const sel = [
      'li.catalog-grid__cell', '.catalog-grid__cell',
      'rz-catalog-tile', 'app-goods-tile-default', 'rz-product-tile',
      '.goods-tile', '.product-card',
      'div.item'
    ].join(',');
    const list = Array.from(document.querySelectorAll(sel));
    const seen = new Set();
    for (const n of list) {
      const cell = getGridCell(n);
      if (!cell) continue;
      const id = cell.__rzCellId || (cell.__rzCellId = Math.random().toString(36).slice(2));
      if (seen.has(id)) continue;
      // basic sanity: must contain something product-like
      const scope = getCardScope(cell);
      if (!scope.querySelector('a[href*="/p"]') &&
          !scope.querySelector('[data-testid="stars-rating"], .stars__rating') &&
          !scope.querySelector('.goods-tile__price-value, .price.color-red, [class*="price__value"], [class*="price-value"]')) {
        continue;
      }
      seen.add(id);
      cb(cell);
    }
  }

  function processCell(cell) {
    const info = getInfo(cell);
    // expose attrs for debugging
    if (info.rating!==null) cell.setAttribute('data-rz-rating', String(info.rating)); else cell.removeAttribute('data-rz-rating');
    if (info.count!==null) cell.setAttribute('data-rz-reviews', String(info.count)); else cell.removeAttribute('data-rz-reviews');
    if (info.price!==null) cell.setAttribute('data-rz-price', String(info.price)); else cell.removeAttribute('data-rz-price');
    cell.setAttribute('data-rz-top', info.top ? '1' : '0');

    const hide = mustHide(info);
    if (hide) cell.classList.add(HIDE_CLASS); else cell.classList.remove(HIDE_CLASS);

    ensureHoverPortalButton(cell); // analytics button
  }

  function sweep(){ eachTileCell(processCell); }

  // ====== Analytics FAB & Panel (with auto-close & cancellation) ======
  const fab = (() => {
    const wrap = document.createElement('div'); wrap.className = 'rz-analytics-fab';
    const btn = document.createElement('button'); btn.textContent = 'Аналитика'; wrap.appendChild(btn);
    document.addEventListener('DOMContentLoaded', () => { document.body.appendChild(wrap); });
    return { wrap, btn };
  })();
  let fabAttachedFor = null;
  let fabHideTimer = null;

  function positionFab(cell) {
    const r = cell.getBoundingClientRect();
    const x = (window.scrollX || document.documentElement.scrollLeft) + r.left + 8;
    const y = (window.scrollY || document.documentElement.scrollTop) + r.bottom - 36;
    fab.wrap.style.left = x + 'px'; fab.wrap.style.top = y + 'px';
  }
  function showFab(cell){ fabAttachedFor = cell; positionFab(cell); fab.wrap.classList.add('show'); }
  function hideFabSoon(delay=120){ clearTimeout(fabHideTimer); fabHideTimer=setTimeout(()=>{ fab.wrap.classList.remove('show'); fabAttachedFor=null; }, delay); }
  function ensureHoverPortalButton(cell) {
    if (cell.__rzHoverInit) return;
    cell.__rzHoverInit = true;
    cell.addEventListener('mouseenter', () => { clearTimeout(fabHideTimer); showFab(cell); });
    cell.addEventListener('mouseleave', (e) => { const to = e.relatedTarget; if (fab.wrap.contains(to)) return; hideFabSoon(180); });
  }
  fab.wrap.addEventListener('mouseenter', () => { clearTimeout(fabHideTimer); });
  fab.wrap.addEventListener('mouseleave', () => { hideFabSoon(120); });

  // Use a regular Map instead of WeakMap so that we can iterate over all
  // panel entries when closing them. WeakMap doesn't expose its keys, which
  // caused "panels.keys is not a function" errors in closeAllPanels().
  const panels = new Map(); // cell -> panelEl
  const inflight = new WeakMap(); // cell -> {seq:number, cancelFns: Function[]}

  function bumpSeq(cell) {
    let st = inflight.get(cell);
    if (!st) { st = { seq: 0, cancelFns: [] }; inflight.set(cell, st); }
    st.seq++;
    try { st.cancelFns.forEach(fn => fn()); } catch {}
    st.cancelFns = [];
    return st.seq;
  }
  function addCancel(cell, fn) {
    let st = inflight.get(cell);
    if (!st) { st = { seq: 0, cancelFns: [] }; inflight.set(cell, st); }
    st.cancelFns.push(fn);
  }
  function currentSeq(cell) { return inflight.get(cell)?.seq ?? 0; }
  function cancelInflight(cell) {
    const st = inflight.get(cell);
    if (!st) return;
    try { st.cancelFns.forEach(fn => fn()); } catch {}
    st.cancelFns = []; st.seq++;
  }

  function showPanel(cell, html) {
    let panel = panels.get(cell);
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'rz-analytics-portal';
      const close = document.createElement('button'); close.className = 'rz-analytics-close'; close.textContent = '×';
      close.addEventListener('click', () => { cancelInflight(cell); panel.remove(); panels.delete(cell); });
      panel.appendChild(close);
      const content = document.createElement('div'); content.className = 'rz-analytics-content'; panel.appendChild(content);
      document.body.appendChild(panel);
      const onPos = () => positionPanel(cell, panel);
      window.addEventListener('scroll', onPos, { passive:true });
      window.addEventListener('resize', onPos);
      const ro = new ResizeObserver(onPos);
      ro.observe(document.documentElement); ro.observe(cell);
      panels.set(cell, panel);
    }
    panel.querySelector('.rz-analytics-content').innerHTML = html;
    positionPanel(cell, panel);
  }
  function positionPanel(cell, panel) {
    const r = cell.getBoundingClientRect();
    const sx = window.scrollX || document.documentElement.scrollLeft;
    const sy = window.scrollY || document.documentElement.scrollTop;
    const left = Math.max(12, Math.min(sx + r.left, sx + document.documentElement.clientWidth - panel.offsetWidth - 12));
    const top = sy + r.bottom + 8;
    panel.style.left = left + 'px'; panel.style.top = top + 'px';
  }

  function closeAllPanels() {
    const cells = Array.from(panels.keys());
    for (const cell of cells) {
      cancelInflight(cell);
      const p = panels.get(cell);
      if (p) p.remove();
      panels.delete(cell);
    }
  }

  fab.btn.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    const cell = fabAttachedFor; if (!cell) return;
    const seq = bumpSeq(cell);
    showPanel(cell, '<div class="rz-analytics-loading">Собираю отзывы по месяцам…</div>');
    try {
      const commentsUrl = extractCommentsUrl(cell);
      if (!commentsUrl) throw new Error('Не нашёл ссылку на комментарии');
      const { agg, pagesFetched } = await collectCommentsMonthlyAgg(commentsUrl, 20, cell, seq);
      if (seq !== currentSeq(cell)) return;
      showPanel(cell, renderMonthlyTable(agg, pagesFetched));
    } catch (err) {
      if (seq !== currentSeq(cell)) return;
      showPanel(cell, `<div class="rz-analytics-error">Ошибка: ${err?.message || err}</div>`);
    }
  });

  window.addEventListener('scroll', () => { if (fabAttachedFor) positionFab(fabAttachedFor); }, { passive:true });
  window.addEventListener('resize', () => { if (fabAttachedFor) positionFab(fabAttachedFor); });

  // auto-close panels on navigation
  const closeOnNav = () => { closeAllPanels(); hideFabSoon(0); };
  ['popstate','beforeunload','visibilitychange'].forEach(ev => window.addEventListener(ev, closeOnNav));
  // close panels immediately when following links in the same tab
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const a = e.target.closest('a[href]');
    if (!a) return;
    if (a.target && a.target !== '_self' && a.target !== '') return;
    if (a.closest('.rz-analytics-portal, .rz-analytics-fab')) return;
    closeOnNav();
  }, { capture: true });
  // hook SPA navigation
  (function hookHistory(){
    const push = history.pushState, replace = history.replaceState;
    history.pushState = function(){ closeAllPanels(); return push.apply(this, arguments); };
    history.replaceState = function(){ closeAllPanels(); return replace.apply(this, arguments); };
  })();

  // ====== COMMENTS LOADER (with per-review stars & date) ======
  function extractCommentsUrl(cell) {
    const scope = getCardScope(cell);
    const a = scope.querySelector('a.rating-block-rating[href*="/comments/"], a.black-link.rating-block-rating[href*="/comments/"], a[href*="/comments/"]');
    if (a) { try { return new URL(a.getAttribute('href'), location.href).href; } catch {} }
    const prod = scope.querySelector('a.goods-tile__heading[href], a[href*="/p"]');
    if (prod) {
      try { const u = new URL(prod.getAttribute('href'), location.href); u.hash=''; let p=u.pathname; if(!p.endsWith('/')) p+='/'; p+='comments/'; u.pathname=p; return u.href; } catch {}
    }
    return null;
  }

  async function fetchDoc(url, signal) {
    try {
      const r = await fetch(url, { credentials: 'include', mode: 'same-origin', signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      return new DOMParser().parseFromString(html, 'text/html');
    } catch (e) {
      if (signal?.aborted) throw new Error('canceled');
      return await loadDocViaIframe(url, signal);
    }
  }

  function loadDocViaIframe(url, signal, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:1px;height:1px;opacity:0;visibility:hidden;';
      let done = false;
      const cleanup = () => { if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe); };
      const finish = (doc) => { if (done) return; done=true; cleanup(); resolve(doc); };
      const fail = (err) => { if (done) return; done=true; cleanup(); reject(err); };
      const onLoad = () => {
        try {
          const doc = iframe.contentDocument;
          if (!doc) return fail(new Error('iframe no document'));
          const mo = new MutationObserver(() => {
            if (signal?.aborted) { try{mo.disconnect();}catch{}; return fail(new Error('canceled')); }
            const ok = !!doc.body && doc.body.children.length > 0;
            if (ok) { mo.disconnect(); finish(doc); }
          });
          mo.observe(doc.documentElement, { childList:true, subtree:true });
          let tries = 0;
          const iv = setInterval(() => {
            if (signal?.aborted) { clearInterval(iv); try{mo.disconnect();}catch{}; return fail(new Error('canceled')); }
            tries++;
            if (!!doc.body && doc.body.children.length > 0) { clearInterval(iv); try{mo.disconnect();}catch{}; finish(doc); }
            else if (tries > 120) { clearInterval(iv); try{mo.disconnect();}catch{}; fail(new Error('iframe empty document')); }
          }, 100);
        } catch (err) { fail(err); }
      };
      iframe.addEventListener('load', onLoad, { once: true });
      document.body.appendChild(iframe);
      requestAnimationFrame(() => { iframe.src = url; });
      setTimeout(() => fail(new Error('iframe timeout')), timeoutMs);
    });
  }

  // Parse month words
  const MONTH_WORDS = {
    'января':1,'январь':1,'февраля':2,'февраль':2,'марта':3,'март':3,'апреля':4,'апрель':4,'мая':5,'май':5,
    'июня':6,'июнь':6,'июля':7,'июль':7,'августа':8,'август':8,'сентября':9,'сентябрь':9,'октября':10,'октябрь':10,
    'ноября':11,'ноябрь':11,'декабря':12,'декабрь':12,
    'січня':1,'січень':1,'лютого':2,'лютий':2,'березня':3,'березень':3,'квітня':4,'квітень':4,'травня':5,'травень':5,
    'червня':6,'червень':6,'липня':7,'липень':7,'серпня':8,'серпень':8,'вересня':9,'вересень':9,'жовтня':10,'жовтень':10,
    'листопада':11,'листопад':11,'грудня':12,'грудень':12
  };
  function pad2(n){return n<10?'0'+n:''+n;}
  function ymKey(y,m){return `${y}-${pad2(m)}`;}
  function parseDateFromTimeText(s) {
    if (!s) return null;
    s = s.replace(/\u00a0/g, ' ').trim().toLowerCase();
    const m = s.match(/(\d{1,2})\s+([A-Za-zА-Яа-яЁёІіЇїЄєґҐ]+)\s+(\d{4})/i);
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const monthWord = m[2];
    const year = parseInt(m[3], 10);
    const month = MONTH_WORDS[monthWord];
    if (!month || isNaN(day) || isNaN(year)) return null;
    return { y: year, m: month };
  }

  function extractReviewItems(doc) {
    // Heuristic: each review item usually contains a time[testid*date]
    const nodes = Array.from(doc.querySelectorAll('time[data-testid="replay-header-date"], time[data-testid*="date"]')).map(t => t.closest('article, li, div, .comment-list__item') || t.parentElement);
    // de-dup
    return Array.from(new Set(nodes.filter(Boolean)));
  }

  function extractStarsFromReview(node) {
    // find nearest stars-rating inside review node
    const el = node.querySelector('[data-testid="stars-rating"].stars__rating, .stars__rating[data-testid="stars-rating"], [data-testid="stars-rating"]');
    if (!el) return null;
    const styleAttr = el.getAttribute('style') || '';
    let m = styleAttr.match(/calc\(\s*(\d+(?:\.\d+)?)%\s*[-+]/i); if (!m) m = styleAttr.match(/(\d+(?:\.\d+)?)%/i);
    if (!m) return null;
    const pct=parseFloat(m[1]); if (Number.isNaN(pct)) return null;
    return Math.max(0, Math.min(5, pct / 20));
  }

  async function collectCommentsMonthlyAgg(startUrl, pageLimit, cell, seq) {
    const agg = new Map(); // ym -> {count, sum, rated}
    let nextUrl = startUrl; let pagesFetched = 0;
    const ac = new AbortController();
    addCancel(cell, () => ac.abort());

    while (nextUrl && pagesFetched < pageLimit) {
      if (seq !== currentSeq(cell)) throw new Error('canceled');
      const doc = await fetchDoc(nextUrl, ac.signal);
      if (seq !== currentSeq(cell)) throw new Error('canceled');

      // harvest by review
      const items = extractReviewItems(doc);
      for (const it of items) {
        const t = it.querySelector('time[data-testid="replay-header-date"], time[data-testid*="date"]');
        const parsed = parseDateFromTimeText(t?.textContent || '');
        if (!parsed) continue;
        const stars = extractStarsFromReview(it);
        const key = ymKey(parsed.y, parsed.m);
        const prev = agg.get(key) || { count:0, sum:0, rated:0 };
        prev.count += 1; // total reviews
        if (typeof stars === 'number') {
          prev.sum += stars;
          prev.rated += 1; // only count reviews with stars for avg
        }
        agg.set(key, prev);
      }

      nextUrl = findNextCommentsPageUrl(doc, nextUrl);
      pagesFetched++;
    }
    return { agg, pagesFetched };
  }

  function findNextCommentsPageUrl(doc, baseUrl) {
    let link = doc.querySelector('a[rel="next"]');
    if (!link) link = doc.querySelector('a.pagination__direction--forward, a.pagination__direction_next, a[aria-label*="След"], a[aria-label*="Далі"], a[aria-label*="Вперед"], a[aria-label*="Next"]');
    if (!link) {
      const active = doc.querySelector('.pagination__link_state_active, .pagination__link--active, li.active a');
      const nextA = active?.closest('li')?.nextElementSibling?.querySelector('a[href]');
      if (nextA) link = nextA;
    }
    if (!link) return null;
    const href = link.getAttribute('href');
    try { return new URL(href, baseUrl).href; } catch { return null; }
  }

  function renderMonthlyTable(agg, pagesFetched) {
    const entries = Array.from(agg.entries()).map(([ym, {count, sum, rated}]) => {
      const avg = rated ? (sum / rated) : 0;
      return [ym, count, avg];
    }).sort((a,b)=> b[0].localeCompare(a[0]) ); // DESC
    if (entries.length === 0) return `<div class="rz-analytics-error">Не удалось найти даты отзывов (${pagesFetched} стр.).</div>`;
    const rows = entries.map(([ym,c,avg])=>`<tr><td>${ym}</td><td>${c}</td><td>${avg.toFixed(2)}★</td></tr>`).join('');
    return `<div class="rz-analytics-title">Отзывов и средняя ★ по месяцам <small>(страниц: ${pagesFetched})</small></div>
      <table><thead><tr><th>Месяц</th><th>Кол-во</th><th>Средняя ★</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // ====== OBSERVERS ======
  function throttle(fn, wait){ let last=0,timer; return function(...a){ const now=Date.now(); const rem=wait-(now-last); if(rem<=0){ last=now; fn.apply(this,a); } else if(!timer){ timer=setTimeout(()=>{ last=Date.now(); timer=null; fn.apply(this,a); }, rem); } } }
  const throttledSweep = throttle(sweep, 300);
  function startObserver(){ if (observer) observer.disconnect(); observer=new MutationObserver(()=>throttledSweep()); observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true}); window.addEventListener('scroll', throttledSweep, {passive:true}); window.addEventListener('popstate', ()=>setTimeout(()=>sweep(),50)); }
  function startHeartbeat(){ let count=0; clearInterval(heartbeatTimer); heartbeatTimer=setInterval(()=>{ sweep(); count++; if(count>12){ clearInterval(heartbeatTimer); heartbeatTimer=setInterval(()=>sweep(),3000); } },1000); }
  function applySettings(newSettings){ settings={...settings,...newSettings}; sweep(); }

  chrome.runtime.onMessage.addListener((msg,_s,sendResponse)=>{
    if (msg?.type === 'RZ_UPDATE_SETTINGS') {
      applySettings(msg.payload || {});
      const storageObj={}; for (const [k,v] of Object.entries(msg.payload || {})) storageObj[K[k]||k]=v;
      chrome.storage.sync.set(storageObj);
      sendResponse?.({ ok:true });
      return true;
    }
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if (area!=='sync') return;
    const updated={};
    for (const [key,delta] of Object.entries(changes)) {
      const settingKey = Object.entries(K).find(([k,v])=>v===key)?.[0];
      if (!settingKey) continue;
      updated[settingKey]=delta.newValue;
    }
    ['ratingMin','ratingMax','reviewsMin','reviewsMax','priceMin','priceMax'].forEach(k=>{ if(k in updated) updated[k]=toNum(updated[k]); });
    applySettings(updated);
  });

  loadSettings(()=>{ startObserver(); startHeartbeat(); sweep(); });
})();
