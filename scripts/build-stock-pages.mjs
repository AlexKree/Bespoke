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

const BUILD_DATE = new Date();
const TODAY = BUILD_DATE.toISOString().slice(0, 10);
// Les offres portent une date de validite : un an glissant a partir du build.
const PRICE_VALID_UNTIL = new Date(BUILD_DATE.getTime() + 365 * 864e5).toISOString().slice(0, 10);

// Vendeur, aligne sur le noeud Organization de la page d'accueil (meme @id).
const DEALER = {
  '@type': ['AutoDealer', 'Organization'],
  '@id': `${SITE}/#organization`,
  name: 'The Bespoke Car',
  url: SITE,
  logo: `${SITE}/assets/icons/icon-512.svg`,
  image: `${SITE}/assets/photos/og-inventory.jpg`,
  email: 'contact@thebespokecar.com',
  address: {
    '@type': 'PostalAddress',
    streetAddress: '1530 Chemin de Peyniblou',
    addressLocality: 'Sophia-Antipolis',
    postalCode: '06560',
    addressCountry: 'FR',
  },
  areaServed: ['FR', 'BE', 'CH', 'LU', 'DE', 'IT', 'ES', 'GB'],
  sameAs: [
    'https://x.com/TheBespokeCar',
    'https://www.linkedin.com/company/112966970',
    'https://www.facebook.com/share/1GVeANHskq/?mibextid=wwXIfr',
    'https://www.instagram.com/thebespokecar',
  ],
};

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

const slug = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

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

// Moteur : ne produit un noeud EngineSpecification que si une donnee existe.
function engineSpec(item) {
  const power = item.power_hp != null ? Number(item.power_hp) : null;
  const cc = item.engine_cc != null ? Number(item.engine_cc) : null;
  if (power == null && cc == null && !item.engine) return null;
  return {
    '@type': 'EngineSpecification',
    ...(item.engine ? { name: item.engine } : {}),
    ...(power != null ? { enginePower: { '@type': 'QuantitativeValue', value: power, unitCode: 'BHP' } } : {}),
    ...(cc != null ? { engineDisplacement: { '@type': 'QuantitativeValue', value: cc, unitCode: 'CMQ' } } : {}),
  };
}

function jsonLd(item, l, t, url) {
  const title = (item.title && (item.title[l] || item.title.fr)) || item.model || item.id;
  const desc = (item.description && (item.description[l] || item.description.fr)) || title;
  const images = item.images.slice(0, 6).map((p) => cdnRaw(p, 1200));
  const engine = engineSpec(item);

  const vehicle = {
    '@type': item.vehicle_type === 'motorcycle' ? 'Motorcycle' : 'Car',
    '@id': `${url}#vehicle`,
    name: title,
    ...(item.make ? { brand: { '@type': 'Brand', name: item.make } } : {}),
    ...(item.model ? { model: item.model } : {}),
    ...(item.year ? { vehicleModelDate: String(item.year), productionDate: String(item.year) } : {}),
    ...(item.mileage_km ? {
      mileageFromOdometer: { '@type': 'QuantitativeValue', value: item.mileage_km, unitCode: 'KMT' },
    } : {}),
    // Champs optionnels : emis uniquement si stock.json les renseigne. Le
    // chantier de completude des donnees enrichit donc le balisage sans
    // toucher a ce script.
    ...(item.transmission ? { vehicleTransmission: item.transmission } : {}),
    ...(item.fuel_type ? { fuelType: item.fuel_type } : {}),
    ...(engine ? { vehicleEngine: engine } : {}),
    ...(item.body_type ? { bodyType: item.body_type } : {}),
    ...(item.doors != null ? { numberOfDoors: Number(item.doors) } : {}),
    ...(item.drive ? { driveWheelConfiguration: item.drive } : {}),
    ...(item.steering ? { steeringPosition: item.steering } : {}),
    ...(item.exterior_color ? { color: item.exterior_color } : {}),
    ...(item.interior_color ? { vehicleInteriorColor: item.interior_color } : {}),
    ...(item.vin ? { vehicleIdentificationNumber: item.vin } : {}),
    ...(item.country ? { availableAtOrFrom: { '@type': 'Place', address: item.country } } : {}),
    ...(images.length ? { image: images } : {}),
    description: desc.slice(0, 2400),
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'EUR',
      ...(item.price_eur != null
        ? { price: item.price_eur, priceValidUntil: PRICE_VALID_UNTIL }
        : {}),
      availability: item.status === 'sold'
        ? 'https://schema.org/SoldOut'
        : item.status === 'reserved'
          ? 'https://schema.org/LimitedAvailability'
          : 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/UsedCondition',
      businessFunction: 'http://purl.org/goodrelations/v1#Sell',
      ...(item.country ? { areaServed: item.country } : {}),
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

  return JSON.stringify({ '@context': 'https://schema.org', '@graph': [vehicle, breadcrumb, DEALER] });
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

/* ── Pages de collection : par marque et par categorie ────────────────── */

const NOW_YEAR = BUILD_DATE.getFullYear();

// Traductions propres aux pages de collection.
const FT = {
  fr: {
    browse: 'Parcourir le stock', byMake: 'Par marque', byCategory: 'Par catégorie',
    allStock: 'Tout le stock', inStock: (n) => `${n} véhicule${n > 1 ? 's' : ''} en stock`,
    seeAll: 'Voir tout le stock', ask: 'Une recherche précise ? Parlez-nous de votre projet',
    motos: 'Motos', motosIntro: 'Motos de collection et de prestige disponibles chez The Bespoke Car — sourcées, contrôlées et importées sur mandat.',
    young: 'Youngtimers', youngIntro: 'Youngtimers (20 à 40 ans) disponibles : la génération devenue collector, sourcée et importée par The Bespoke Car.',
    makeIntro: (m) => `Nos ${m} de collection et de prestige actuellement disponibles chez The Bespoke Car : véhicules sourcés, contrôlés et importés sur mandat, livrés partout en Europe.`,
  },
  en: {
    browse: 'Browse the stock', byMake: 'By make', byCategory: 'By category',
    allStock: 'All stock', inStock: (n) => `${n} vehicle${n > 1 ? 's' : ''} in stock`,
    seeAll: 'See the full stock', ask: 'Looking for something specific? Tell us about your project',
    motos: 'Motorcycles', motosIntro: 'Collector and prestige motorcycles available at The Bespoke Car — sourced, inspected and imported on mandate.',
    young: 'Youngtimers', youngIntro: 'Youngtimers (20 to 40 years old) available: the generation that turned collectible, sourced and imported by The Bespoke Car.',
    makeIntro: (m) => `Our ${m} collector and prestige cars currently available at The Bespoke Car: vehicles sourced, inspected and imported on mandate, delivered across Europe.`,
  },
};

// Construit la liste des facettes (marques + categories) a partir du stock dispo.
// Seuils : marque >= 1 vehicule, categorie >= 3 (pas de page maigre).
function computeFacets(pool) {
  const facets = [];

  const byMake = new Map();
  for (const v of pool) {
    if (!v.make) continue;
    const key = v.make;
    if (!byMake.has(key)) byMake.set(key, []);
    byMake.get(key).push(v);
  }
  for (const [make, list] of [...byMake].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Une page de marque n'a de sens que si elle regroupe plusieurs vehicules ;
    // sinon c'est un doublon maigre de la fiche (penalisant en SEO).
    if (list.length < 2) continue;
    facets.push({
      kind: 'make',
      slug: slug(make),
      file: { fr: `marque-${slug(make)}.html`, en: `make-${slug(make)}.html` },
      name: { fr: make, en: make },
      title: { fr: `${make} de collection à vendre`, en: `${make} collector cars for sale` },
      intro: { fr: FT.fr.makeIntro(make), en: FT.en.makeIntro(make) },
      items: list,
    });
  }

  const motos = pool.filter((v) => v.vehicle_type === 'motorcycle');
  if (motos.length >= 3) {
    facets.push({
      kind: 'category', slug: 'motos',
      file: { fr: 'motos.html', en: 'motorcycles.html' },
      name: { fr: FT.fr.motos, en: FT.en.motos },
      title: { fr: 'Motos de collection à vendre', en: 'Collector motorcycles for sale' },
      intro: { fr: FT.fr.motosIntro, en: FT.en.motosIntro },
      items: motos,
    });
  }

  const young = pool.filter((v) => v.year && NOW_YEAR - v.year >= 20 && NOW_YEAR - v.year <= 40);
  if (young.length >= 3) {
    facets.push({
      kind: 'category', slug: 'youngtimers',
      file: { fr: 'youngtimers.html', en: 'youngtimers.html' },
      name: { fr: FT.fr.young, en: FT.en.young },
      title: { fr: 'Youngtimers à vendre', en: 'Youngtimers for sale' },
      intro: { fr: FT.fr.youngIntro, en: FT.en.youngIntro },
      items: young,
    });
  }

  return facets;
}

function facetCard(v, l, t) {
  const title = (v.title && (v.title[l] || v.title.fr)) || v.model || v.id;
  const img = v.images[0];
  const meta = [v.year, v.price_eur != null ? eur(v.price_eur, l) : t.onRequest, v.country || null]
    .filter(Boolean).join(' · ');
  return `        <a class="vpRelatedCard" href="${esc(v.slug)}.html">
          ${img ? `<img src="${cdn(img, 560)}" alt="${esc(title)}" width="560" height="350" loading="lazy" decoding="async"/>` : '<div class="vpRelatedNoImg"></div>'}
          <div class="vpRelatedBody">
            <span class="vpRelatedTitle">${esc(title)}</span>
            <span class="vpRelatedMeta">${esc(meta)}</span>
          </div>
        </a>`;
}

function renderFacetPage(facet, l, allFacets) {
  const t = T[l];
  const ft = FT[l];
  const name = facet.name[l];
  const url = `${SITE}/${l}/stock/${facet.file[l]}`;
  const list = [...facet.items].sort((a, b) => (b.year || 0) - (a.year || 0));
  const metaDesc = `${facet.intro[l]} ${ft.inStock(list.length)}.`.replace(/\s+/g, ' ').trim().slice(0, 300);
  const ogImage = (list[0] && list[0].images[0]) ? cdnRaw(list[0].images[0], 1200) : `${SITE}/assets/photos/og-inventory.jpg`;

  const itemList = {
    '@type': 'ItemList',
    name: facet.title[l],
    numberOfItems: list.length,
    itemListElement: list.map((v, i) => ({
      '@type': 'ListItem', position: i + 1,
      url: `${SITE}/${l}/stock/${v.slug}.html`,
      name: (v.title && (v.title[l] || v.title.fr)) || v.model || v.id,
    })),
  };
  const collectionPage = {
    '@type': 'CollectionPage',
    '@id': url, url, name: facet.title[l], description: metaDesc, inLanguage: l === 'fr' ? 'fr-FR' : 'en-GB',
    isPartOf: { '@id': `${SITE}/#website` }, about: { '@id': `${SITE}/#organization` },
  };
  const breadcrumb = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: t.home, item: `${SITE}/${l}/` },
      { '@type': 'ListItem', position: 2, name: t.stock, item: `${SITE}/${l}/stock.html` },
      { '@type': 'ListItem', position: 3, name, item: url },
    ],
  };
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': [collectionPage, itemList, breadcrumb, DEALER] });

  // Nav vers les autres facettes (maillage interne).
  const makeLinks = allFacets.filter((f) => f.kind === 'make')
    .map((f) => `<a href="${esc(f.file[l])}"${f.slug === facet.slug ? ' aria-current="page"' : ''}>${esc(f.name[l])}</a>`).join(' · ');
  const catLinks = allFacets.filter((f) => f.kind === 'category')
    .map((f) => `<a href="${esc(f.file[l])}"${f.slug === facet.slug ? ' aria-current="page"' : ''}>${esc(f.name[l])}</a>`).join(' · ');

  return `<!doctype html>
<html lang="${l}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(facet.title[l])} — Bespoke</title>
  <meta name="description" content="${esc(metaDesc)}" />
  <meta name="robots" content="index,follow" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../../assets/styles.css?v=6" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="#05101e" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${url}" />
  <meta property="og:title" content="${esc(facet.title[l])}" />
  <meta property="og:description" content="${esc(metaDesc)}" />
  <meta property="og:image" content="${esc(ogImage)}" />
  <meta property="og:locale" content="${l}_${l === 'fr' ? 'FR' : 'GB'}" />
  <meta property="og:site_name" content="The Bespoke Car" />
  <link rel="canonical" href="${url}" />
  <link rel="alternate" hreflang="fr" href="${SITE}/fr/stock/${facet.file.fr}" />
  <link rel="alternate" hreflang="en" href="${SITE}/en/stock/${facet.file.en}" />
  <link rel="alternate" hreflang="x-default" href="${SITE}/en/stock/${facet.file.en}" />
  <script defer data-domain="thebespokecar.com" src="https://plausible.io/js/script.js"></script>
  <script>window.plausible = window.plausible || function() { (window.plausible.q = window.plausible.q || []).push(arguments); };</script>
  <script type="application/ld+json">${ld}</script>
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
        <li aria-current="page">${esc(name)}</li>
      </ol>
    </nav>

    <div class="card pad-lg">
      <div class="kicker">${esc(ft.browse)}</div>
      <h1>${esc(facet.title[l])}</h1>
      <p class="lead">${esc(facet.intro[l])}</p>
      <p class="mini">${esc(ft.inStock(list.length))}</p>
      <nav class="stockFacets" aria-label="${esc(ft.browse)}">
        ${makeLinks ? `<div><span class="stockFacetsLabel">${esc(ft.byMake)} :</span> ${makeLinks}</div>` : ''}
        ${catLinks ? `<div><span class="stockFacetsLabel">${esc(ft.byCategory)} :</span> ${catLinks}</div>` : ''}
        <div><a href="../stock.html">${esc(ft.allStock)}</a></div>
      </nav>
    </div>

    <div class="vpRelated" style="margin-top:22px">
${list.map((v) => facetCard(v, l, t)).join('\n')}
    </div>

    <div class="ctaRow" style="margin-top:24px">
      <a class="btn primary" href="../contact.html" onclick="plausible('Lead')">${esc(ft.ask)}</a>
      <a class="btn" href="../stock.html">${esc(ft.seeAll)}</a>
    </div>
    <div class="vpDisclaimer">${esc(t.disclaimer)}</div>
  </div>
</main>
${shell[l].footer}
<script src="../../assets/site.js"></script>
</body>
</html>
`;
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
let facetPages = 0;
const warnings = [];

const facets = computeFacets(items.filter((i) => i.slug && i.status !== 'sold'));

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

  // Pages de collection (par marque, par categorie).
  for (const facet of facets) {
    writeFileSync(join(dir, facet.file[l]), renderFacetPage(facet, l, facets));
    facetPages++;
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

const available = items.filter((i) => i.slug && i.status !== 'sold');

const urls = [`  <url><loc>${SITE}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>`];
for (const l of LANGS) {
  for (const [p, prio] of STATIC) {
    urls.push(`  <url><loc>${SITE}/${l}/${p}</loc><changefreq>monthly</changefreq><priority>${prio}</priority></url>`);
  }
  urls.push(`  <url><loc>${SITE}/${l}/${MARKET[l]}</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>`);
  urls.push(`  <url><loc>${SITE}/${l}/${GALLERY[l]}</loc><changefreq>monthly</changefreq><priority>0.4</priority></url>`);
}
// Fiches vehicule : une entree par langue, liees entre elles par hreflang, avec
// les images en extension image-sitemap (utile pour Google Images sur des autos).
for (const l of LANGS) {
  for (const item of available) {
    const alternates = LANGS.map((al) =>
      `    <xhtml:link rel="alternate" hreflang="${al}" href="${SITE}/${al}/stock/${item.slug}.html"/>`
    ).concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/en/stock/${item.slug}.html"/>`);
    const imgs = item.images.slice(0, 6).map((p) =>
      `    <image:image><image:loc>${SITE}${p.startsWith('/') ? '' : '/'}${p}</image:loc></image:image>`
    );
    urls.push(
      `  <url><loc>${SITE}/${l}/stock/${item.slug}.html</loc>` +
      `<lastmod>${TODAY}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority>\n` +
      [...alternates, ...imgs].join('\n') + '\n  </url>'
    );
  }
}
// Pages de collection (marque / categorie), liees par hreflang FR<->EN.
for (const l of LANGS) {
  for (const facet of facets) {
    const alts = LANGS.map((al) =>
      `    <xhtml:link rel="alternate" hreflang="${al}" href="${SITE}/${al}/stock/${facet.file[al]}"/>`
    ).concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/en/stock/${facet.file.en}"/>`);
    urls.push(
      `  <url><loc>${SITE}/${l}/stock/${facet.file[l]}</loc>` +
      `<lastmod>${TODAY}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority>\n` +
      alts.join('\n') + '\n  </url>'
    );
  }
}

writeFileSync(join(ROOT, 'sitemap.xml'), [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
  '        xmlns:xhtml="http://www.w3.org/1999/xhtml"',
  '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
  urls.join('\n'),
  '</urlset>',
  '',
].join('\n'));

writeFileSync(join(ROOT, 'robots.txt'),
  `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /setup-staff.html\n\n` +
  `Sitemap: ${SITE}/sitemap.xml\n`);

/* ── Flux de distribution (portails, Merchant Center, catalogue Meta) ──── */
// Meme source que les fiches : un enregistrement admin -> rebuild -> flux a jour.
// Seuls les vehicules disponibles y figurent ; un vehicule vendu en sort aussitot.

function feedFields(item) {
  const titleFr = (item.title && (item.title.fr || item.title.en)) || item.model || item.id;
  const titleEn = (item.title && (item.title.en || item.title.fr)) || item.model || item.id;
  const descFr = (item.description && (item.description.fr || item.description.en)) || '';
  const descEn = (item.description && (item.description.en || item.description.fr)) || '';
  return {
    id: item.id,
    ref: item.ref || item.id,
    vin: item.vin || '',
    url_fr: `${SITE}/fr/stock/${item.slug}.html`,
    url_en: `${SITE}/en/stock/${item.slug}.html`,
    title_fr: titleFr,
    title_en: titleEn,
    make: item.make || '',
    model: item.model || '',
    year: item.year || '',
    price_eur: item.price_eur != null ? item.price_eur : '',
    price_on_request: item.price_eur == null ? 'true' : 'false',
    mileage_km: item.mileage_km != null ? item.mileage_km : '',
    vehicle_type: item.vehicle_type || 'car',
    body_type: item.body_type || '',
    fuel_type: item.fuel_type || '',
    transmission: item.transmission || '',
    power_hp: item.power_hp != null ? item.power_hp : '',
    engine_cc: item.engine_cc != null ? item.engine_cc : '',
    exterior_color: item.exterior_color || '',
    interior_color: item.interior_color || '',
    steering: item.steering || '',
    country: item.country || '',
    condition: 'used',
    availability: 'in stock',
    sale_category: item.sale_category || 'both',
    description_fr: descFr.replace(/\s+/g, ' ').trim(),
    description_en: descEn.replace(/\s+/g, ' ').trim(),
    image_links: item.images.map((p) => `${SITE}${p.startsWith('/') ? '' : '/'}${p}`),
    date_modified: TODAY,
  };
}

const feedRows = available.map(feedFields);

// 1. Flux XML — schema generique, lisible, adaptable par portail.
const xmlEsc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlFeed = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<vehicles generated="${BUILD_DATE.toISOString()}" source="${SITE}" count="${feedRows.length}">`,
];
for (const r of feedRows) {
  xmlFeed.push('  <vehicle>');
  for (const [k, v] of Object.entries(r)) {
    if (k === 'image_links') {
      xmlFeed.push('    <images>');
      for (const u of v) xmlFeed.push(`      <image>${xmlEsc(u)}</image>`);
      xmlFeed.push('    </images>');
    } else {
      xmlFeed.push(`    <${k}>${xmlEsc(v)}</${k}>`);
    }
  }
  xmlFeed.push('  </vehicle>');
}
xmlFeed.push('</vehicles>', '');
writeFileSync(join(ROOT, 'stock-feed.xml'), xmlFeed.join('\n'));

// 2. Flux CSV — accepte par la plupart des portails et par le catalogue Meta.
const csvCols = Object.keys(feedRows[0] || feedFields(items[0]));
const csvEsc = (v) => {
  const s = Array.isArray(v) ? v.join('|') : String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const csvFeed = '﻿' + [
  csvCols.join(','),
  ...feedRows.map((r) => csvCols.map((c) => csvEsc(r[c])).join(',')),
].join('\r\n') + '\r\n';
writeFileSync(join(ROOT, 'stock-feed.csv'), csvFeed);

/* ── Liste crawlable injectee dans stock.html (FR + EN) ───────────────── */
// La grille de stock.html est rendue en JavaScript : le HTML brut ne contient
// aucun lien vers les fiches. On insere ici une liste statique de liens entre
// deux marqueurs. stock.js la masque une fois la grille interactive prete ;
// sans JavaScript, elle sert de repli.

const LIST_START = '<!-- STOCK:LIST:START -->';
const LIST_END = '<!-- STOCK:LIST:END -->';
const listIntro = {
  fr: 'Véhicules disponibles',
  en: 'Available vehicles',
};

let listOk = 0;
let listUpdated = 0;
for (const l of LANGS) {
  const file = join(ROOT, l, 'stock.html');
  if (!existsSync(file)) { warnings.push(`${l}/stock.html introuvable : liste non injectee`); continue; }
  let html = readFileSync(file, 'utf8');
  if (!html.includes(LIST_START) || !html.includes(LIST_END)) {
    warnings.push(`${l}/stock.html : marqueurs ${LIST_START} absents, liste non injectee`);
    continue;
  }
  listOk++;
  const lis = available.map((item) => {
    const title = (item.title && (item.title[l] || item.title.fr)) || item.model || item.id;
    const bits = [
      item.year,
      item.price_eur != null ? eur(item.price_eur, l) : T[l].onRequest,
      item.country || null,
    ].filter(Boolean).join(' · ');
    return `          <li><a href="stock/${esc(item.slug)}.html">${esc(title)}</a>` +
           `<span class="stockStaticMeta"> — ${esc(bits)}</span></li>`;
  }).join('\n');
  const facetNav = facets.length
    ? `      <nav class="stockFacets" aria-label="${esc(FT[l].browse)}">\n` +
      `        <span class="stockFacetsLabel">${esc(FT[l].byMake)} :</span> ` +
      facets.filter((f) => f.kind === 'make')
        .map((f) => `<a href="stock/${esc(f.file[l])}">${esc(f.name[l])}</a>`).join(' · ') +
      (facets.some((f) => f.kind === 'category')
        ? `\n        <span class="stockFacetsLabel">${esc(FT[l].byCategory)} :</span> ` +
          facets.filter((f) => f.kind === 'category')
            .map((f) => `<a href="stock/${esc(f.file[l])}">${esc(f.name[l])}</a>`).join(' · ')
        : '') +
      `\n      </nav>\n`
    : '';
  const block =
    `${LIST_START}\n` +
    facetNav +
    `      <nav class="stockStaticList" id="stockStaticList" aria-label="${esc(listIntro[l])}">\n` +
    `        <h2 class="visually-hidden">${esc(listIntro[l])}</h2>\n` +
    `        <ul>\n${lis}\n        </ul>\n` +
    `      </nav>\n      ${LIST_END}`;
  const next = html.replace(
    new RegExp(LIST_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + LIST_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    () => block
  );
  if (next !== html) { writeFileSync(file, next); listUpdated++; }
}

console.log(`${written} pages vehicule generees (${items.length} vehicules x ${LANGS.length} langues)`);
console.log(`${facetPages} pages de collection generees (${facets.length} facettes x ${LANGS.length} langues) : ${facets.map((f) => f.slug).join(', ')}`);
console.log(`sitemap.xml : ${urls.length} URL`);
console.log(`stock-feed.xml / stock-feed.csv : ${feedRows.length} vehicules disponibles`);
console.log(`liste crawlable : ${listOk}/${LANGS.length} pages stock.html (${listUpdated} mise(s) a jour ce build)`);
console.log('robots.txt ecrit');
if (warnings.length) {
  console.log('\nAvertissements :');
  warnings.forEach((w) => console.log('  ' + w));
}
