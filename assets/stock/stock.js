(() => {
  const grid = document.getElementById('stockGrid');
  if (!grid) return;

  const lang = (window.__BESPOKE_LANG__ || document.documentElement.lang || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';

  const T = {
    fr: {
      available: 'Disponible',
      sold: 'Vendue',
      reserved: 'Réservée',
      year: 'Année',
      location: 'Localisation',
      mileage: 'Kilométrage',
      priceOnRequest: 'Prix sur demande',
      hideSold: 'Masquer vendues',
      details: 'Détails',
      contact: 'Contacter',
      searchEmpty: 'Aucun résultat.',
      error: 'Impossible de charger le stock.',
      views: 'vues',
      catAll: 'Tous',
      catParticulier: 'Vente au Particulier',
      catProfessionnel: 'Vente au Professionnel',
      catLabel: 'Catégorie',
      allMakes: 'Toutes les marques',
      anyPrice: 'Tous les prix',
      anyYear: 'Toutes les années',
      seeSheet: 'Voir la fiche',
      quickView: 'Aperçu'
    },
    en: {
      available: 'Available',
      sold: 'Sold',
      reserved: 'Reserved',
      year: 'Year',
      location: 'Location',
      mileage: 'Mileage',
      priceOnRequest: 'Price on request',
      hideSold: 'Hide sold',
      details: 'Details',
      contact: 'Contact',
      searchEmpty: 'No results.',
      error: 'Unable to load stock.',
      views: 'views',
      catAll: 'All',
      catParticulier: 'Private Sale',
      catProfessionnel: 'Trade Sale',
      catLabel: 'Category',
      allMakes: 'All makes',
      anyPrice: 'Any price',
      anyYear: 'Any year',
      seeSheet: 'View details',
      quickView: 'Quick view'
    }
  }[lang];

  const basePrefix = '../';
  const dataUrl = basePrefix + 'assets/stock/stock.json';
  const searchEl = document.getElementById('stockSearch');
  const makeEl = document.getElementById('stockMake');
  const priceEl = document.getElementById('stockPrice');
  const yearEl = document.getElementById('stockYear');
  const includeSoldEl = document.getElementById('includeSold');
  const sortEl = document.getElementById('stockSort');
  const catFilterEl = document.getElementById('stockCatFilter');

  // Active category filter: 'all' | 'particulier' | 'professionnel'
  let activeCat = 'all';

  if (catFilterEl) {
    catFilterEl.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeCat = btn.getAttribute('data-cat');
        catFilterEl.querySelectorAll('[data-cat]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        applyFilters();
      });
    });
  }

  if (includeSoldEl) {
    const label = includeSoldEl.closest('label');
    if (label) {
      const span = label.querySelector('span');
      if (span) span.textContent = T.hideSold;
    }
  }

  const modal = document.getElementById('stockModal');
  const modalMainImage = document.getElementById('modalMainImage');
  const modalThumbs = document.getElementById('modalThumbs');
  const modalTitle = document.getElementById('stockModalTitle');
  const modalStatus = document.getElementById('modalStatus');
  const modalMeta = document.getElementById('modalMeta');
  const modalPrice = document.getElementById('modalPrice');
  const modalDescription = document.getElementById('modalDescription');
  const modalContact = document.getElementById('modalContact');

  let items = [];
  let filtered = [];
  let viewCounts = {}; // { [carId]: number }
  let historyModalAdded = false; // tracks whether we pushed a history entry for the open modal
  let ignoreNextPopstate = false; // prevents double-close when closeModal calls history.back()

  function formatPrice(item) {
    if (item.status === 'sold') return T.sold;
    const priceValue = item.price_eur || item.price;
    if (priceValue && typeof priceValue === 'number') {
      try {
        return new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', {
          style: 'currency',
          currency: 'EUR',
          maximumFractionDigits: 0
        }).format(priceValue);
      } catch (_) {
        return priceValue + ' €';
      }
    }
    return T.priceOnRequest;
  }

  function itemTitle(item) {
    if (item.title && item.title[lang]) return item.title[lang];
    if (item.make || item.model) {
      return [item.make, item.model].filter(Boolean).join(' ').trim();
    }
    return item.id || 'Vehicle';
  }

  // Lien "Contacter" : transporte le vehicule (repris par contact.html pour
  // pre-remplir le sujet et le message). Meme schema que le CTA des fiches.
  function contactHref(item) {
    const t = itemTitle(item);
    const label = t + (item.year && String(t).indexOf(String(item.year)) === -1 ? ' (' + item.year + ')' : '');
    let q = 'ref=' + encodeURIComponent(label);
    if (item.slug) {
      const vurl = location.origin + location.pathname.replace(/[^/]*$/, 'stock/' + item.slug + '.html');
      q += '&url=' + encodeURIComponent(vurl);
    }
    return 'contact.html?' + q;
  }

  // stock.json melange les formes "assets/..." et "/assets/..." : on normalise
  // vers un chemin absolu depuis la racine du site.
  function resolveAsset(assetPath) {
    if (!assetPath) return '';
    if (/^https?:/i.test(assetPath)) return assetPath;
    return '/' + String(assetPath).replace(/^\/+/, '');
  }

  // Variantes WebP produites au build (assets/_img). BespokeImg gere le repli
  // sur la conversion a la demande pour une photo pas encore construite.
  const IMG = window.BespokeImg;

  function statusLabel(item) {
    if (item.status === 'sold') return T.sold;
    if (item.status === 'reserved') return T.reserved;
    return T.available;
  }

  function matchesQuery(item, q) {
    if (!q) return true;
    const hay = [
      item.id,
      itemTitle(item),
      item.make,
      item.model,
      item.country,
      item.year ? String(item.year) : '',
      item.mileage ? String(item.mileage) : ''
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  }

  function sortGroup(group) {
    const mode = sortEl ? sortEl.value : 'year_desc';
    const copy = [...group];
    if (mode === 'year_asc') {
      copy.sort((a, b) => (a.year || 0) - (b.year || 0));
    } else if (mode === 'az') {
      copy.sort((a, b) => itemTitle(a).localeCompare(itemTitle(b), lang));
    } else {
      copy.sort((a, b) => (b.year || 0) - (a.year || 0));
    }
    return copy;
  }

  function sortItems(list) {
    const available = list.filter(it => it.status !== 'sold');
    const sold = list.filter(it => it.status === 'sold');
    return [...sortGroup(available), ...sortGroup(sold)];
  }

  function matchesCategory(item) {
    if (activeCat === 'all') return true;
    const cat = item.sale_category || 'both';
    if (cat === 'both') return true;
    return cat === activeCat;
  }

  function matchesMake(item) {
    const v = makeEl ? makeEl.value : '';
    return !v || item.make === v;
  }

  function matchesPrice(item) {
    const v = priceEl ? priceEl.value : '';
    if (!v) return true;
    // Un vehicule sans prix affiche ("sur demande") ne peut pas etre filtre
    // par tranche : on le garde plutot que de le faire disparaitre en silence.
    if (item.price_eur == null) return true;
    const [lo, hi] = v.split('-');
    if (lo && item.price_eur < Number(lo)) return false;
    if (hi && item.price_eur > Number(hi)) return false;
    return true;
  }

  function matchesYear(item) {
    const v = yearEl ? yearEl.value : '';
    if (!v || item.year == null) return !v;
    const [lo, hi] = v.split('-');
    if (lo && item.year < Number(lo)) return false;
    if (hi && item.year > Number(hi)) return false;
    return true;
  }

  function applyFilters() {
    const q = (searchEl ? searchEl.value : '').trim().toLowerCase();
    const hideSold = !!(includeSoldEl && includeSoldEl.checked);
    filtered = items.filter((it) => {
      if (hideSold && it.status === 'sold') return false;
      if (!matchesCategory(it)) return false;
      if (!matchesMake(it)) return false;
      if (!matchesPrice(it)) return false;
      if (!matchesYear(it)) return false;
      return matchesQuery(it, q);
    });
    filtered = sortItems(filtered);
    render();
  }

  /** Remplit le selecteur de marques avec celles reellement presentes. */
  function populateMakes() {
    if (!makeEl) return;
    const makes = [...new Set(items.map((i) => i.make).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    makeEl.innerHTML = '<option value="">' + T.allMakes + '</option>' +
      makes.map((m) => '<option value="' + m.replace(/"/g, '&quot;') + '">' + m + '</option>').join('');
  }

  function catLabel(cat) {
    if (cat === 'particulier') return T.catParticulier;
    if (cat === 'professionnel') return T.catProfessionnel;
    // 'both' or unset
    return null;
  }

  function renderCard(item) {
    const isSold = item.status === 'sold';
    const isReserved = item.status === 'reserved';
    const card = document.createElement('div');
    card.className = 'stockCard' + (isSold ? ' stockCardSold' : '');
    card.setAttribute('data-id', item.id);

    const imgWrap = document.createElement('div');
    imgWrap.className = 'stockCardImage';

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = itemTitle(item);
    if (item.images && item.images.length) {
      IMG.apply(img, item.images[0], 760, [400, 560, 760],
                '(max-width: 620px) 100vw, (max-width: 1040px) 50vw, 361px');
      img.width = 761; img.height = 476; // ratio 16/10, evite le saut de mise en page
    }
    if (isSold) img.style.filter = 'grayscale(40%) opacity(0.75)';
    imgWrap.appendChild(img);

    const badge = document.createElement('div');
    badge.className = 'stockBadge ' + (isSold ? 'sold' : isReserved ? 'reserved' : 'available');
    badge.textContent = statusLabel(item);
    imgWrap.appendChild(badge);

    const viewsBadge = document.createElement('div');
    viewsBadge.className = 'viewsBadge';
    viewsBadge.setAttribute('data-views-id', item.id);
    const count = viewCounts[item.id] || 0;
    viewsBadge.textContent = count + '\u00a0' + T.views;
    imgWrap.appendChild(viewsBadge);

    card.appendChild(imgWrap);

    const body = document.createElement('div');
    body.className = 'stockCardBody';

    const h3 = document.createElement('div');
    h3.className = 'stockCardTitle';
    h3.textContent = itemTitle(item);
    if (isSold) h3.style.opacity = '0.6';
    body.appendChild(h3);

    const meta = document.createElement('div');
    meta.className = 'stockCardMeta';
    const year = item.year ? `${T.year}: ${item.year}` : '';
    const mileage = item.mileage ? `${T.mileage}: ${item.mileage}` : '';
    const loc = item.country || '';
    meta.textContent = [year, mileage, loc ? `${T.location}: ${loc}` : ''].filter(Boolean).join(' • ');
    body.appendChild(meta);

    const price = document.createElement('div');
    price.className = 'stockCardPrice';
    price.textContent = formatPrice(item);
    if (isSold) price.style.color = '#e05c5c';
    body.appendChild(price);

    const cat = item.sale_category || 'both';
    if (cat !== 'both') {
      const catBadge = document.createElement('div');
      catBadge.className = 'stockCatBadge stockCatBadge--' + cat;
      catBadge.textContent = cat === 'particulier' ? T.catParticulier : T.catProfessionnel;
      body.appendChild(catBadge);
    } else {
      const catBadgeWrap = document.createElement('div');
      catBadgeWrap.style.display = 'flex';
      catBadgeWrap.style.gap = '4px';
      catBadgeWrap.style.flexWrap = 'wrap';
      const b1 = document.createElement('div');
      b1.className = 'stockCatBadge stockCatBadge--particulier';
      b1.textContent = T.catParticulier;
      const b2 = document.createElement('div');
      b2.className = 'stockCatBadge stockCatBadge--professionnel';
      b2.textContent = T.catProfessionnel;
      catBadgeWrap.appendChild(b1);
      catBadgeWrap.appendChild(b2);
      body.appendChild(catBadgeWrap);
    }

    const actions = document.createElement('div');
    actions.className = 'stockCardActions';

    // Lien reel plutot que bouton : la fiche a une URL propre, indexable et
    // partageable. La modale reste disponible en apercu rapide.
    if (item.slug) {
      const link = document.createElement('a');
      link.className = 'btn btnSecondary btnSm';
      link.href = 'stock/' + item.slug + '.html';
      link.textContent = T.seeSheet;
      link.addEventListener('click', (e) => e.stopPropagation());
      actions.appendChild(link);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btnSm';
    btn.textContent = T.quickView;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openModal(item);
    });
    actions.appendChild(btn);

    if (!isSold) {
      const contact = document.createElement('a');
      contact.className = 'btn btnPrimary btnSm';
      contact.textContent = T.contact;
      contact.href = contactHref(item);
      contact.addEventListener('click', (e) => e.stopPropagation());
      actions.appendChild(contact);
    }

    body.appendChild(actions);
    card.appendChild(body);
    // Clic sur la carte : on va sur la vraie fiche (URL propre, partageable,
    // indexable). La modale reste accessible par le bouton « Apercu ». Sans
    // slug (fiche pas encore normalisee), on retombe sur la modale.
    card.addEventListener('click', () => {
      if (item.slug) window.location.href = 'stock/' + item.slug + '.html';
      else openModal(item);
    });
    return card;
  }

  function render() {
    grid.innerHTML = '';
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'card pad';
      empty.textContent = T.searchEmpty;
      grid.appendChild(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    filtered.forEach((it) => frag.appendChild(renderCard(it)));
    grid.appendChild(frag);
  }

  function closeModalUI() {
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    modalMainImage.src = '';
    modalThumbs.innerHTML = '';
  }

  function closeModal() {
    if (!modal) return;
    closeModalUI();
    if (historyModalAdded) {
      historyModalAdded = false;
      ignoreNextPopstate = true;
      window.history.back();
    }
  }

  function openModal(item) {
    if (!modal) return;

    // Increment view counter (fire-and-forget, silent on error)
    incrementView(item.id);

    modalTitle.textContent = itemTitle(item);
    modalStatus.textContent = statusLabel(item);
    modalStatus.className = 'kicker ' + (item.status === 'sold' ? 'sold' : item.status === 'reserved' ? 'reserved' : 'available');

    const loc = item.country || '';
    const metaBits = [];
    if (item.year) metaBits.push(`${T.year}: ${item.year}`);
    if (item.mileage) metaBits.push(`${T.mileage}: ${item.mileage}`);
    if (loc) metaBits.push(`${T.location}: ${loc}`);
    modalMeta.textContent = metaBits.join(' • ');

    modalPrice.textContent = formatPrice(item);
    modalPrice.style.color = item.status === 'sold' ? '#e05c5c' : '';

    // Sale category
    const existingCatBadge = modal.querySelector('.modalCatBadge');
    if (existingCatBadge) existingCatBadge.remove();
    const cat = item.sale_category || 'both';
    const modalInfo = modal.querySelector('.modalInfo');
    if (modalInfo) {
      const catWrap = document.createElement('div');
      catWrap.className = 'modalCatBadge';
      catWrap.style.display = 'flex';
      catWrap.style.gap = '6px';
      catWrap.style.flexWrap = 'wrap';
      catWrap.style.margin = '8px 0';
      if (cat === 'particulier' || cat === 'both') {
        const b = document.createElement('div');
        b.className = 'stockCatBadge stockCatBadge--particulier';
        b.textContent = T.catParticulier;
        catWrap.appendChild(b);
      }
      if (cat === 'professionnel' || cat === 'both') {
        const b = document.createElement('div');
        b.className = 'stockCatBadge stockCatBadge--professionnel';
        b.textContent = T.catProfessionnel;
        catWrap.appendChild(b);
      }
      // Insert after modalPrice
      const priceEl = modal.querySelector('.price');
      if (priceEl && priceEl.parentNode) {
        priceEl.parentNode.insertBefore(catWrap, priceEl.nextSibling);
      } else {
        modalInfo.insertBefore(catWrap, modalInfo.firstChild);
      }
    }

    modalDescription.textContent = (item.description && (item.description[lang] || item.description.en || item.description.fr)) || '';
    modalContact.href = contactHref(item);

    // ── Reserve button (shown only when user is logged in and vehicle is available) ──
    const existingReserveBtn = modal.querySelector('.modalReserveBtn');
    if (existingReserveBtn) existingReserveBtn.remove();
    if (item.status === 'available' && (item.price_eur || item.price) && window.__bespokeOpenReserve) {
      const reserveBtn = document.createElement('button');
      reserveBtn.type = 'button';
      reserveBtn.className = 'btn btnPrimary modalReserveBtn';
      reserveBtn.textContent = lang === 'fr' ? 'Réserver ce véhicule' : 'Reserve this vehicle';
      reserveBtn.style.marginTop = '10px';
      reserveBtn.addEventListener('click', () => {
        const title = itemTitle(item);
        window.__bespokeOpenReserve(item.id, item.price_eur || item.price, title);
      });
      // Insert before or after the contact button
      const modalInfo = modal.querySelector('.modalInfo');
      if (modalInfo) modalInfo.appendChild(reserveBtn);
    }

    const imgs = item.images || [];
    if (imgs.length) {
      IMG.apply(modalMainImage, imgs[0], 1000, [500, 760, 1000], '(max-width: 700px) 100vw, 493px');
      modalMainImage.alt = itemTitle(item);
      modalMainImage.style.filter = item.status === 'sold' ? 'grayscale(30%) opacity(0.8)' : '';

      modalThumbs.innerHTML = '';
      imgs.forEach((src, idx) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'thumbBtn' + (idx === 0 ? ' active' : '');
        const im = document.createElement('img');
        IMG.apply(im, src, 160);
        im.alt = '';
        im.loading = 'lazy';
        im.decoding = 'async';
        b.appendChild(im);
        b.addEventListener('click', () => {
          IMG.apply(modalMainImage, src, 1000, [500, 760, 1000], '(max-width: 700px) 100vw, 493px');
          [...modalThumbs.querySelectorAll('.thumbBtn')].forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
        });
        modalThumbs.appendChild(b);
      });
    }

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');

    // Push a history entry so the browser back button closes the modal instead of navigating away
    window.history.pushState({ modal: 'vehicle', id: item.id }, '', '#vehicle-' + encodeURIComponent(item.id));
    historyModalAdded = true;
  }

  // Un lien du type /fr/stock#vehicle-<id> a ete partage avant l'arrivee des
  // fiches a URL propre : on rouvre la modale correspondante a l'ouverture.
  function openFromHash() {
    const m = (location.hash || '').match(/^#vehicle-(.+)$/);
    if (!m) return;
    const id = decodeURIComponent(m[1]);
    const item = items.find((it) => String(it.id) === id);
    if (item) openModal(item);
  }

  function wireModal() {
    if (!modal) return;
    modal.addEventListener('click', (e) => {
      const close = e.target && e.target.getAttribute && e.target.getAttribute('data-close');
      if (close) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
    // Handle browser back button: close modal without reloading the page
    window.addEventListener('popstate', () => {
      if (ignoreNextPopstate) {
        ignoreNextPopstate = false;
        return;
      }
      if (historyModalAdded && modal && modal.classList.contains('open')) {
        historyModalAdded = false;
        closeModalUI();
      }
    });
  }

  async function fetchViews(ids) {
    if (!ids.length) return;
    try {
      const res = await fetch('/.netlify/functions/views?ids=' + ids.map(encodeURIComponent).join(','));
      if (!res.ok) return;
      const data = await res.json();
      Object.assign(viewCounts, data);
      // Update already-rendered badges in the grid
      ids.forEach((id) => {
        const el = grid.querySelector('[data-views-id="' + id + '"]');
        if (el) el.textContent = (viewCounts[id] || 0) + '\u00a0' + T.views;
      });
    } catch (_) { /* fail silently */ }
  }

  function incrementView(carId) {
    fetch('/.netlify/functions/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ carId }),
    })
      .then((res) => {
        if (!res.ok) return;
        return res.json();
      })
      .then((data) => {
        if (!data || typeof data.views !== 'number') return;
        viewCounts[carId] = data.views;
        // Update the badge in the grid if it's visible
        const el = grid.querySelector('[data-views-id="' + carId + '"]');
        if (el) el.textContent = data.views + '\u00a0' + T.views;
      })
      .catch(() => { /* fail silently */ });
  }

  async function init() {
    try {
      const res = await fetch(dataUrl + '?v=' + Date.now(), { cache: 'no-cache' });
      const data = await res.json();
      items = (data && data.items) ? data.items : [];
      populateMakes();
      applyFilters();
      wireModal();
      openFromHash(); // lien #vehicle-<id> partage : rouvrir la modale a l'arrivee
      // Batch-fetch view counts for all cars (silent fail)
      fetchViews(items.map((it) => it.id));
    } catch (e) {
      grid.innerHTML = '<div class="card pad">' + T.error + '</div>';
    }
  }

  // Expose a reload function for the reservation flow
  window.__bespokeReloadStock = async function () {
    try {
      const res = await fetch(dataUrl + '?v=' + Date.now(), { cache: 'no-cache' });
      const data = await res.json();
      items = (data && data.items) ? data.items : [];
      populateMakes();
      applyFilters();
    } catch (_) {}
  };

  function wireFilters() {
    if (searchEl) searchEl.addEventListener('input', applyFilters);
    if (includeSoldEl) includeSoldEl.addEventListener('change', applyFilters);
    if (sortEl) sortEl.addEventListener('change', applyFilters);
    if (makeEl) makeEl.addEventListener('change', applyFilters);
    if (priceEl) priceEl.addEventListener('change', applyFilters);
    if (yearEl) yearEl.addEventListener('change', applyFilters);
    // catFilterEl buttons are wired above at declaration time
  }

  wireFilters();
  init();
})();
