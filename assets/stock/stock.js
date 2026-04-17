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
      priceOnRequest: 'Prix sur demande',
      hideSold: 'Masquer vendues',
      details: 'Détails',
      contact: 'Contacter',
      searchEmpty: 'Aucun résultat.',
      error: 'Impossible de charger le stock.',
      views: 'vues'
    },
    en: {
      available: 'Available',
      sold: 'Sold',
      reserved: 'Reserved',
      year: 'Year',
      location: 'Location',
      priceOnRequest: 'Price on request',
      hideSold: 'Hide sold',
      details: 'Details',
      contact: 'Contact',
      searchEmpty: 'No results.',
      error: 'Unable to load stock.',
      views: 'views'
    }
  }[lang];

  const basePrefix = '../';
  const dataUrl = basePrefix + 'assets/stock/stock.json?v=' + Date.now();
  const searchEl = document.getElementById('stockSearch');
  const includeSoldEl = document.getElementById('includeSold');
  const sortEl = document.getElementById('stockSort');

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
    if (item.price_eur && typeof item.price_eur === 'number') {
      try {
        return new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', {
          style: 'currency',
          currency: 'EUR',
          maximumFractionDigits: 0
        }).format(item.price_eur);
      } catch (_) {
        return item.price_eur + ' €';
      }
    }
    return T.priceOnRequest;
  }

  function itemTitle(item) {
    if (item.title && item.title[lang]) return item.title[lang];
    if (item.make && item.model) {
      const make = item.make[lang] || item.make.en || item.make.fr || '';
      const model = item.model[lang] || item.model.en || item.model.fr || '';
      return (make + ' ' + model).trim();
    }
    return item.id || 'Vehicle';
  }

  function resolveAsset(assetPath) {
    return basePrefix + assetPath.replace(/^/, '');
  }

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
      item.make && (item.make[lang] || item.make.en || item.make.fr),
      item.model && (item.model[lang] || item.model.en || item.model.fr),
      item.year ? String(item.year) : ''
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

  function applyFilters() {
    const q = (searchEl ? searchEl.value : '').trim().toLowerCase();
    const hideSold = !!(includeSoldEl && includeSoldEl.checked);
    filtered = items.filter((it) => {
      if (hideSold && it.status === 'sold') return false;
      return matchesQuery(it, q);
    });
    filtered = sortItems(filtered);
    render();
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
    img.src = item.images && item.images.length ? resolveAsset(item.images[0]) : '';
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
    const loc = item.location ? (item.location[lang] || item.location.en || item.location.fr) : '';
    meta.textContent = [year, loc ? `${T.location}: ${loc}` : ''].filter(Boolean).join(' • ');
    body.appendChild(meta);

    const price = document.createElement('div');
    price.className = 'stockCardPrice';
    price.textContent = formatPrice(item);
    if (isSold) price.style.color = '#e05c5c';
    body.appendChild(price);

    const actions = document.createElement('div');
    actions.className = 'stockCardActions';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btnSecondary btnSm';
    btn.textContent = T.details;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openModal(item);
    });
    actions.appendChild(btn);

    if (!isSold) {
      const contact = document.createElement('a');
      contact.className = 'btn btnPrimary btnSm';
      contact.textContent = T.contact;
      contact.href = 'contact.html?vehicle=' + encodeURIComponent(item.id);
      actions.appendChild(contact);
    }

    body.appendChild(actions);
    card.appendChild(body);
    card.addEventListener('click', () => openModal(item));
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

    const loc = item.location ? (item.location[lang] || item.location.en || item.location.fr) : '';
    const metaBits = [];
    if (item.year) metaBits.push(`${T.year}: ${item.year}`);
    if (loc) metaBits.push(`${T.location}: ${loc}`);
    modalMeta.textContent = metaBits.join(' • ');

    modalPrice.textContent = formatPrice(item);
    modalPrice.style.color = item.status === 'sold' ? '#e05c5c' : '';

    modalDescription.textContent = (item.description && (item.description[lang] || item.description.en || item.description.fr)) || '';
    modalContact.href = 'contact.html?vehicle=' + encodeURIComponent(item.id);

    // ── Reserve button (shown only when user is logged in and vehicle is available) ──
    const existingReserveBtn = modal.querySelector('.modalReserveBtn');
    if (existingReserveBtn) existingReserveBtn.remove();
    if (item.status === 'available' && item.price_eur && window.__bespokeOpenReserve) {
      const reserveBtn = document.createElement('button');
      reserveBtn.type = 'button';
      reserveBtn.className = 'btn btnPrimary modalReserveBtn';
      reserveBtn.textContent = lang === 'fr' ? 'Réserver ce véhicule' : 'Reserve this vehicle';
      reserveBtn.style.marginTop = '10px';
      reserveBtn.addEventListener('click', () => {
        const title = itemTitle(item);
        window.__bespokeOpenReserve(item.id, item.price_eur, title);
      });
      // Insert before or after the contact button
      const modalInfo = modal.querySelector('.modalInfo');
      if (modalInfo) modalInfo.appendChild(reserveBtn);
    }

    const imgs = (item.images || []).map(resolveAsset);
    if (imgs.length) {
      modalMainImage.src = imgs[0];
      modalMainImage.alt = itemTitle(item);
      modalMainImage.style.filter = item.status === 'sold' ? 'grayscale(30%) opacity(0.8)' : '';

      modalThumbs.innerHTML = '';
      imgs.forEach((src, idx) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'thumbBtn' + (idx === 0 ? ' active' : '');
        const im = document.createElement('img');
        im.src = src;
        im.alt = '';
        im.loading = 'lazy';
        b.appendChild(im);
        b.addEventListener('click', () => {
          modalMainImage.src = src;
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
      const res = await fetch(dataUrl + '&t=' + Date.now(), { cache: 'no-cache' });
      const data = await res.json();
      items = (data && data.items) ? data.items : [];
      applyFilters();
      wireModal();
      // Batch-fetch view counts for all cars (silent fail)
      fetchViews(items.map((it) => it.id));
    } catch (e) {
      grid.innerHTML = '<div class="card pad">' + T.error + '</div>';
    }
  }

  // Expose a reload function for the reservation flow
  window.__bespokeReloadStock = async function () {
    try {
      const res = await fetch(dataUrl + '&t=' + Date.now(), { cache: 'no-cache' });
      const data = await res.json();
      items = (data && data.items) ? data.items : [];
      applyFilters();
    } catch (_) {}
  };

  function wireFilters() {
    if (searchEl) searchEl.addEventListener('input', applyFilters);
    if (includeSoldEl) includeSoldEl.addEventListener('change', applyFilters);
    if (sortEl) sortEl.addEventListener('change', applyFilters);
  }

  wireFilters();
  init();
})();
