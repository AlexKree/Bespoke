
(() => {
  const grid = document.getElementById('stockGrid');
  if (!grid) return;

  const lang = (window.__BESPOKE_LANG__ || document.documentElement.lang || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';

  const T = {
    fr: {
      available: 'Disponible',
      sold: 'Vendu',
      year: 'Année',
      location: 'Localisation',
      priceOnRequest: 'Prix sur demande',
      includeSold: 'Inclure vendus',
      details: 'Détails',
      contact: 'Contacter',
      searchEmpty: 'Aucun résultat.',
      error: 'Impossible de charger le stock.'
    },
    en: {
      available: 'Available',
      sold: 'Sold',
      year: 'Year',
      location: 'Location',
      priceOnRequest: 'Price on request',
      includeSold: 'Include sold',
      details: 'Details',
      contact: 'Contact',
      searchEmpty: 'No results.',
      error: 'Unable to load stock.'
    }
  }[lang];

  const basePrefix = '../';
  const dataUrl = basePrefix + 'assets/stock/stock.json';

  const searchEl = document.getElementById('stockSearch');
  const includeSoldEl = document.getElementById('includeSold');
  const sortEl = document.getElementById('stockSort');

  // Modal
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
    // assetPath is like "assets/stock/images/xxx.jpg"
    return basePrefix + assetPath.replace(/^\//, '');
  }

  function statusLabel(item) {
    return item.status === 'sold' ? T.sold : T.available;
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

  function sortItems(list) {
    const mode = sortEl ? sortEl.value : 'year_desc';
    const copy = [...list];
    if (mode === 'year_asc') {
      copy.sort((a, b) => (a.year || 0) - (b.year || 0));
    } else if (mode === 'az') {
      copy.sort((a, b) => itemTitle(a).localeCompare(itemTitle(b), lang));
    } else {
      copy.sort((a, b) => (b.year || 0) - (a.year || 0));
    }
    return copy;
  }

  function applyFilters() {
    const q = (searchEl ? searchEl.value : '').trim().toLowerCase();
    const includeSold = !!(includeSoldEl && includeSoldEl.checked);

    filtered = items.filter((it) => {
      if (!includeSold && it.status === 'sold') return false;
      return matchesQuery(it, q);
    });

    filtered = sortItems(filtered);
    render();
  }

  function renderCard(item) {
    const card = document.createElement('div');
    card.className = 'stockCard';
    card.setAttribute('data-id', item.id);

    const imgWrap = document.createElement('div');
    imgWrap.className = 'stockCardImage';

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = itemTitle(item);
    img.src = item.images && item.images.length ? resolveAsset(item.images[0]) : '';
    imgWrap.appendChild(img);

    const badge = document.createElement('div');
    badge.className = 'stockBadge ' + (item.status === 'sold' ? 'sold' : 'available');
    badge.textContent = statusLabel(item);
    imgWrap.appendChild(badge);

    card.appendChild(imgWrap);

    const body = document.createElement('div');
    body.className = 'stockCardBody';

    const h3 = document.createElement('div');
    h3.className = 'stockCardTitle';
    h3.textContent = itemTitle(item);
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

    const contact = document.createElement('a');
    contact.className = 'btn btnPrimary btnSm';
    contact.textContent = T.contact;
    contact.href = 'contact.html?vehicle=' + encodeURIComponent(item.id);

    actions.appendChild(btn);
    actions.appendChild(contact);
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

  function closeModal() {
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    modalMainImage.src = '';
    modalThumbs.innerHTML = '';
  }

  function openModal(item) {
    if (!modal) return;

    modalTitle.textContent = itemTitle(item);
    modalStatus.textContent = statusLabel(item);
    modalStatus.className = 'kicker ' + (item.status === 'sold' ? 'sold' : 'available');

    const loc = item.location ? (item.location[lang] || item.location.en || item.location.fr) : '';
    const metaBits = [];
    if (item.year) metaBits.push(`${T.year}: ${item.year}`);
    if (loc) metaBits.push(`${T.location}: ${loc}`);
    modalMeta.textContent = metaBits.join(' • ');

    modalPrice.textContent = formatPrice(item);
    modalDescription.textContent = (item.description && (item.description[lang] || item.description.en || item.description.fr)) || '';

    modalContact.href = 'contact.html?vehicle=' + encodeURIComponent(item.id);

    // Images
    const imgs = (item.images || []).map(resolveAsset);
    if (imgs.length) {
      modalMainImage.src = imgs[0];
      modalMainImage.alt = itemTitle(item);

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
  }

  async function init() {
    try {
      const res = await fetch(dataUrl, { cache: 'no-cache' });
      const data = await res.json();
      items = (data && data.items) ? data.items : [];
      applyFilters();
      wireModal();
    } catch (e) {
      grid.innerHTML = '<div class="card pad">' + T.error + '</div>';
    }
  }

  function wireFilters() {
    if (searchEl) searchEl.addEventListener('input', applyFilters);
    if (includeSoldEl) includeSoldEl.addEventListener('change', applyFilters);
    if (sortEl) sortEl.addEventListener('change', applyFilters);
  }

  wireFilters();
  init();
})();
