
(() => {
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;

  const basePrefix = '../';
  const dataUrl = basePrefix + 'assets/gallery/gallery.json';

  // Image CDN Netlify : conversion WebP + redimensionnement a la volee.
  function cdn(assetPath, width, quality) {
    if (!assetPath) return '';
    if (/^https?:/i.test(assetPath)) return assetPath;
    const src = '/' + String(assetPath).replace(/^\/+/, '');
    return '/.netlify/images?url=' + encodeURIComponent(src) +
           '&w=' + width + '&fm=webp&q=' + (quality || 72);
  }
  function cdnSrcset(assetPath, widths, quality) {
    return widths.map((w) => cdn(assetPath, w, quality) + ' ' + w + 'w').join(', ');
  }

  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImage');

  function openLightbox(src, alt) {
    lightboxImg.src = src;
    lightboxImg.alt = alt || '';
    lightbox.classList.add('open');
    lightbox.setAttribute('aria-hidden', 'false');
  }

  function closeLightbox() {
    lightbox.classList.remove('open');
    lightbox.setAttribute('aria-hidden', 'true');
    lightboxImg.src = '';
  }

  function wireLightbox() {
    if (!lightbox) return;
    lightbox.addEventListener('click', (e) => {
      const close = e.target && e.target.getAttribute && e.target.getAttribute('data-close');
      if (close) closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeLightbox();
    });
  }

  function render(items) {
    const frag = document.createDocumentFragment();
    items.forEach((it) => {
      const a = document.createElement('a');
      a.href = '/' + String(it.file).replace(/^\/+/, '');
      a.className = 'galleryItem';
      a.target = '_self';
      a.rel = 'noopener';

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = cdn(it.thumb, 600);
      img.srcset = cdnSrcset(it.thumb, [300, 450, 600]);
      img.sizes = '(max-width: 620px) 50vw, (max-width: 1040px) 33vw, 260px';
      img.alt = it.alt || 'Photo';
      a.appendChild(img);

      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        openLightbox(cdn(it.file, 1600, 80), img.alt);
      });

      frag.appendChild(a);
    });
    grid.innerHTML = '';
    grid.appendChild(frag);
  }

  async function init() {
    try {
      const res = await fetch(dataUrl, { cache: 'no-cache' });
      const data = await res.json();
      render((data && data.items) ? data.items : []);
      wireLightbox();
    } catch (e) {
      grid.innerHTML = '<div class="card pad">Unable to load gallery.</div>';
    }
  }

  init();
})();
