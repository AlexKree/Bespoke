#!/usr/bin/env node
/**
 * Genere une page par vehicule et le sitemap, a partir de assets/stock/stock.json.
 *
 * Sortie :
 *   fr/stock/<slug>.html
 *   en/stock/<slug>.html
 *   sitemap.xml
 *
 * L'en-tete et le pied de page sont extraits de fr/index.html et en/index.html
 * a chaque build : le shell reste donc synchronise sans duplication.
 *
 * Lance par Netlify a chaque deploiement (voir [build] dans netlify.toml), donc
 * un enregistrement depuis l'admin regenere les pages automatiquement.
 *
 *   node scripts/build-stock-pages.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://thebespokecar.com';
const LANGS = ['fr', 'en'];

const stock = JSON.parse(readFileSync(join(ROOT, 'assets/stock/stock.json'), 'utf8'));
const items = stock.items || [];

/* ── Shell ────────────────────────────────────────────────────────────── */

function extract(html, tag) {
  const m = html.match(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`));
  if (!m) throw new Error(`<${tag}> introuvable dans la page d'accueil`);
  return m[0];
}

const shell = {};
for (const l of LANGS) {
  const home = readFileSync(join(ROOT, l, 'index.html'), 'utf8');
  shell[l] = {
    // Les pages vehicule sont un cran plus profond : ../ devient ../../
    header: extract(home, 'header').replace(/(?:\.\.\/)+assets\//g, '../../assets/')
                                   .replace(/href="(?!https?:|\/|#|mailto:)/g, 'href="../'),
    footer: extract(home, 'footer').replace(/(?:\.\.\/)+assets\//g, '../../assets/')
                                   .replace(/href="(?!https?:|\/|#|mailto:)/g, 'href="../'),
  };
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const cdn = (path, w, q = 72) =>
  `/.netlify/images?url=${encodeURIComponent(path)}&amp;w=${w}&amp;fm=webp&amp;q=${q}`;

const cdnRaw = (path, w, q = 72) =>
  `${SITE}/.netlify/images?url=${encodeURIComponent(path)}&w=${w}&fm=webp&q=${q}`;

function eur(n, l) {
  if (n == null) return null;
  return new Intl.NumberFormat(l === 'en' ? 'en-GB' : 'fr-FR',
    { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

const T = {
  fr: {
    home: 'Accueil', stock: 'Stock', onRequest: 'Prix sur demande',
    available: 'Disponible', sold: 'Vendu', reserved: 'Réservé',
    year: 'Année', mileage: 'Kilométrage', location: 'Localisation',
    make: 'Marque', model: 'Modèle', ref: 'Référence', type: 'Type',
    car: 'Automobile', motorcycle: 'Moto',
    forPrivate: 'Vente au particulier', forPro: 'Vente au professionnel', forBoth: 'Particulier et professionnel',
    contact: 'Demander le dossier complet', backToStock: 'Retour au stock',
    related: 'Autres véhicules disponibles', gallery: 'Galerie',
    soldNotice: "Ce véhicule est vendu. Il reste en ligne à titre de référence — nous pouvons rechercher un équivalent.",
    descTitle: 'Description', specsTitle: 'Caractéristiques',
    disclaimer: "Fiche indicative. Les informations sont communiquées de bonne foi et doivent être vérifiées lors de l'inspection. Ne constitue pas une offre contractuelle.",
    inspect: 'Faire analyser les photos', importCost: "Estimer le coût d'import",
  },
  en: {
    home: 'Home', stock: 'Stock', onRequest: 'Price on request',
    available: 'Available', sold: 'Sold', reserved: 'Reserved',
    year: 'Year', mileage: 'Mileage', location: 'Location',
    make: 'Make', model: 'Model', ref: 'Reference', type: 'Type',
    car: 'Car', motorcycle: 'Motorcycle',
    forPrivate: 'Private sale', forPro: 'Trade sale', forBoth: 'Private and trade',
    contact: 'Request the full file', backToStock: 'Back to stock',
    related: 'Other available vehicles', gallery: 'Gallery',
    soldNotice: 'This vehicle has been sold. It remains online for reference — we can source an equivalent.',
    descTitle: 'Description', specsTitle: 'Specifications',
    disclaimer: 'Indicative listing. Information is provided in good faith and must be verified at inspection. This is not a contractual offer.',
    inspect: 'Have photos analysed', importCost: 'Estimate import cost',
  },
};

const statusKey = (s) => (s === 'sold' ? 'sold' : s === 'reserved' ? 'reserved' : 'available');

function saleLabel(cat, t) {
  if (cat === 'particulier') return t.forPrivate;
  if (cat === 'professionnel') return t.forPro;
  return t.forBoth;
}

/* ── Donnees structurees ──────────────────────────────────────────────── */

function jsonLd(item, l, t, url) {
  const title = (item.title && (item.title[l] || item.title.fr)) || item.model || item.id;
  const desc = (item.description && (item.description[l] || item.description.fr)) || title;
  const images = item.images.slice(0, 6).map((p) => cdnRaw(p, 1200));

  const vehicle = {
    '@type': item.vehicle_type === 'motorcycle' ? 'Motorcycle' : 'Car',
    name: title,
    ...(item.make ? { brand: { '@type': 'Brand', name: item.make } } : {}),
    ...(item.model ? { model: item.model } : {}),
    ...(item.year ? { vehicleModelDate: String(item.year), productionDate: String(item.year) } : {}),
    ...(item.mileage_km ? {
      mileageFromOdometer: { '@type': 'QuantitativeValue', value: item.mileage_km, unitCode: 'KMT' },
    } : {}),
    ...(images.length ? { image: images } : {}),
    description: desc.slice(0, 900),
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'EUR',
      ...(item.price_eur != null ? { price: item.price_eur } : {}),
      availability: item.status === 'sold'
        ? 'https://schema.org/SoldOut'
        : item.status === 'reserved'
          ? 'https://schema.org/LimitedAvailability'
          : 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/UsedCondition',
      seller: { '@id': `${SITE}/#organization` },
    },
  };

  const breadcrumb = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: t.home, item: `${SITE}/${l}/` },
      { '@type': 'ListItem', position: 2, name: t.stock, item: `${SITE}/${l}/stock.html` },
      { '@type': 'ListItem', position: 3, name: title, item: url },
    ],
  };

  return JSON.stringify({ '@context': 'https://schema.org', '@graph': [vehicle, breadcrumb] });
}

/* ── Rendu ────────────────────────────────────────────────────────────── */

function renderGallery(item, alt) {
  if (!item.images.length) return '';
  const main = item.images[0];
  const thumbs = item.images.slice(0, 12);
  return `
      <div class="vpMedia">
        <img id="vpMain" class="vpMainImage"
             src="${cdn(main, 1200)}"
             srcset="${[600, 900, 1200].map((w) => `${cdn(main, w)} ${w}w`).join(', ')}"
             sizes="(max-width: 900px) 100vw, 660px"
             alt="${esc(alt)}" width="1200" height="800" fetchpriority="high" decoding="async"/>
${thumbs.length > 1 ? `        <div class="vpThumbs">
${thumbs.map((p, i) => `          <button type="button" class="vpThumb${i === 0 ? ' active' : ''}" data-full="${cdn(p, 1200)}" aria-label="${esc(alt)} — ${i + 1}"><img src="${cdn(p, 200)}" alt="" width="120" height="80" loading="lazy" decoding="async"/></button>`).join('\n')}
        </div>` : ''}
      </div>`;
}

function renderSpecs(item, l, t) {
  const rows = [
    [t.make, item.make],
    [t.model, item.model],
    [t.year, item.year],
    [t.mileage, item.mileage || (item.mileage_km ? item.mileage_km.toLocaleString(l === 'en' ? 'en-GB' : 'fr-FR') + ' km' : null)],
    [t.location, item.country],
    [t.type, item.vehicle_type === 'motorcycle' ? t.motorcycle : t.car],
    [t.ref, saleLabel(item.sale_category, t)],
  ].filter(([, v]) => v != null && v !== '');
  return `<dl class="vpSpecs">
${rows.map(([k, v]) => `            <dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('\n')}
          </dl>`;
}

function renderRelated(item, all, l, t) {
  const pool = all.filter((x) => x.slug !== item.slug && x.status !== 'sold');
  // Meme marque d'abord, puis complement par proximite d'annee.
  const sameMake = pool.filter((x) => x.make && x.make === item.make);
  const rest = pool.filter((x) => !sameMake.includes(x))
    .sort((a, b) => Math.abs((a.year || 0) - (item.year || 0)) - Math.abs((b.year || 0) - (item.year || 0)));
  const picks = [...sameMake, ...rest].slice(0, 3);
  if (!picks.length) return '';
  return `
    <div class="section">
      <div class="sectionTitle"><h2>${esc(t.related)}</h2></div>
      <div class="sep"></div>
      <div class="vpRelated">
${picks.map((v) => {
    const title = (v.title && (v.title[l] || v.title.fr)) || v.model || v.id;
    const img = v.images[0];
    return `        <a class="vpRelatedCard" href="${esc(v.slug)}.html">
          ${img ? `<img src="${cdn(img, 560)}" alt="${esc(title)}" width="560" height="350" loading="lazy" decoding="async"/>` : '<div class="vpRelatedNoImg"></div>'}
          <div class="vpRelatedBody">
            <span class="vpRelatedTitle">${esc(title)}</span>
            <span class="vpRelatedMeta">${esc([v.year, v.price_eur != null ? eur(v.price_eur, l) : t.onRequest].filter(Boolean).join(' · '))}</span>
          </div>
        </a>`;
  }).join('\n')}
      </div>
    </div>`;
}

function renderPage(item, l, all) {
  const t = T[l];
  const title = (item.title && (item.title[l] || item.title.fr)) || item.model || item.id;
  const desc = (item.description && (item.description[l] || item.description.fr)) || '';
  const headline = item.headline && (item.headline[l] || item.headline.fr);
  const st = statusKey(item.status);
  const url = `${SITE}/${l}/stock/${item.slug}.html`;
  const price = item.price_eur != null ? eur(item.price_eur, l) : t.onRequest;

  const metaDesc = (headline || desc || title)
    .replace(/\s+/g, ' ').trim().slice(0, 155);
  const ogImage = item.images.length ? cdnRaw(item.images[0], 1200) : `${SITE}/assets/photos/og-inventory.jpg`;

  return `<!doctype html>
<html lang="${l}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}${item.year ? ` ${item.year}` : ''} — Bespoke</title>
  <meta name="description" content="${esc(metaDesc)}" />
  <meta name="robots" content="${item.status === 'sold' ? 'noindex,follow' : 'index,follow'}" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../../assets/styles.css?v=5" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="#05101e" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Bespoke" />
  <link rel="apple-touch-icon" href="/assets/icons/icon-192.svg" />
  <meta property="og:type" content="product" />
  <meta property="og:url" content="${url}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(metaDesc)}" />
  <meta property="og:image" content="${esc(ogImage)}" />
  <meta property="og:locale" content="${l}_${l === 'fr' ? 'FR' : 'GB'}" />
  <meta property="og:site_name" content="The Bespoke Car" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@TheBespokeCar" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(metaDesc)}" />
  <meta name="twitter:image" content="${esc(ogImage)}" />
  <link rel="canonical" href="${url}" />
  <link rel="alternate" hreflang="fr" href="${SITE}/fr/stock/${item.slug}.html" />
  <link rel="alternate" hreflang="en" href="${SITE}/en/stock/${item.slug}.html" />
  <link rel="alternate" hreflang="x-default" href="${SITE}/en/stock/${item.slug}.html" />
  <script defer data-domain="thebespokecar.com" src="https://plausible.io/js/script.js"></script>
  <script>window.plausible = window.plausible || function() { (window.plausible.q = window.plausible.q || []).push(arguments); };</script>
  <script type="application/ld+json">${jsonLd(item, l, t, url)}</script>
</head>
<body>
${shell[l].header}
<main>
  <div class="container">
    <nav class="breadcrumb" aria-label="${esc(t.stock)}">
      <ol>
        <li><a href="../index.html">${esc(t.home)}</a></li>
        <li>/</li>
        <li><a href="../stock.html">${esc(t.stock)}</a></li>
        <li>/</li>
        <li aria-current="page">${esc(title)}</li>
      </ol>
    </nav>

    <div class="vpLayout">
${renderGallery(item, title)}

      <div class="vpInfo card pad-lg">
        <div class="kicker ${st}">${esc(t[st])}</div>
        <h1 class="vpTitle">${esc(title)}</h1>
${headline ? `        <p class="lead">${esc(headline)}</p>\n` : ''}        <div class="vpPrice">${esc(price)}</div>
${item.status === 'sold' ? `        <div class="vpSoldNotice">${esc(t.soldNotice)}</div>\n` : ''}
        <div class="sep"></div>
        <div class="kicker">${esc(t.specsTitle)}</div>
        ${renderSpecs(item, l, t)}

        <div class="ctaRow">
          <a class="btn primary" href="../contact.html?ref=${encodeURIComponent(title + (item.year && !String(title).includes(String(item.year)) ? ` (${item.year})` : ''))}&amp;url=${encodeURIComponent(url)}" onclick="plausible('Lead')">${esc(t.contact)}</a>
          <a class="btn" href="../stock.html">${esc(t.backToStock)}</a>
        </div>
        <div class="vpToolLinks">
          <a href="../inspection.html">${esc(t.inspect)}</a>
          <a href="../import.html">${esc(t.importCost)}</a>
        </div>
      </div>
    </div>

${desc ? `    <div class="card pad-lg vpDesc">
      <div class="kicker">${esc(t.descTitle)}</div>
      <div class="vpDescBody">${desc.split(/\n{2,}/).map((p) => `<p>${esc(p.trim())}</p>`).join('\n        ')}</div>
    </div>\n` : ''}
    <div class="vpDisclaimer">${esc(t.disclaimer)}</div>
${renderRelated(item, all, l, t)}
  </div>
</main>
${shell[l].footer}
<script src="../../assets/site.js"></script>
<script src="../../assets/stock/vehicle.js"></script>
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js')
        .catch(function (err) { console.warn('SW registration failed:', err); });
    });
  }
</script>
</body>
</html>
`;
}

/* ── Ecriture ─────────────────────────────────────────────────────────── */

let written = 0;
const warnings = [];

for (const l of LANGS) {
  const dir = join(ROOT, l, 'stock');
  // On repart d'un dossier propre : un vehicule retire de stock.json ne doit
  // pas laisser une page orpheline indexee.
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) if (f.endsWith('.html')) rmSync(join(dir, f));
  }
  mkdirSync(dir, { recursive: true });

  for (const item of items) {
    if (!item.slug) { warnings.push(`slug manquant : ${item.id}`); continue; }
    if (l === LANGS[0]) {
      if (!item.images.length) warnings.push(`${item.slug} : aucune photo`);
      for (const img of item.images) {
        const abs = join(ROOT, img.replace(/^\/+/, ''));
        let ok = false;
        try { ok = statSync(abs).isFile(); } catch (_) { ok = false; }
        if (!ok) warnings.push(`${item.slug} : image introuvable ${img}`);
      }
    }
    writeFileSync(join(dir, `${item.slug}.html`), renderPage(item, l, items));
    written++;
  }
}

/* ── Sitemap ──────────────────────────────────────────────────────────── */

const STATIC = [
  ['index.html', 1.0], ['stock.html', 0.9], ['concierge.html', 0.8],
  ['import.html', 0.8], ['inspection.html', 0.8], ['services.html', 0.7],
  ['track-record.html', 0.6], ['a-propos.html', 0.5], ['contact.html', 0.7],
];
const MARKET = { fr: 'marche.html', en: 'market.html' };
const GALLERY = { fr: 'galerie.html', en: 'gallery.html' };
const today = new Date().toISOString().slice(0, 10);

const urls = [`  <url><loc>${SITE}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>`];
for (const l of LANGS) {
  for (const [p, prio] of STATIC) {
    urls.push(`  <url><loc>${SITE}/${l}/${p}</loc><changefreq>monthly</changefreq><priority>${prio}</priority></url>`);
  }
  urls.push(`  <url><loc>${SITE}/${l}/${MARKET[l]}</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>`);
  urls.push(`  <url><loc>${SITE}/${l}/${GALLERY[l]}</loc><changefreq>monthly</changefreq><priority>0.4</priority></url>`);
  for (const item of items) {
    if (!item.slug || item.status === 'sold') continue; // les vendus sont en noindex
    urls.push(`  <url><loc>${SITE}/${l}/stock/${item.slug}.html</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`);
  }
}

writeFileSync(join(ROOT, 'sitemap.xml'), [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  urls.join('\n'),
  '</urlset>',
  '',
].join('\n'));

writeFileSync(join(ROOT, 'robots.txt'),
  `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /setup-staff.html\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`${written} pages vehicule generees (${items.length} vehicules x ${LANGS.length} langues)`);
console.log(`sitemap.xml : ${urls.length} URL`);
console.log('robots.txt ecrit');
if (warnings.length) {
  console.log('\nAvertissements :');
  warnings.forEach((w) => console.log('  ' + w));
}
