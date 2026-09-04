#!/usr/bin/env node
/**
 * Normalisation ponctuelle de assets/stock/stock.json.
 *
 * Le fichier melangeait trois generations de schema : price / price_eur,
 * mileage / mileage_km, country / location, make+model presents sur 2 fiches
 * sur 29. On converge vers le schema qu'ecrit deja l'interface admin, en
 * ajoutant make, model et vehicle_type qui manquaient aux filtres et au SEO.
 *
 * Idempotent : rejouer le script sur un fichier deja normalise ne change rien.
 *
 *   node scripts/normalize-stock.mjs [--dry]
 */

import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../assets/stock/stock.json', import.meta.url);
const dry = process.argv.includes('--dry');

/* Marques reconnues, du libelle le plus long au plus court pour que
   "Mercedes-Benz" l'emporte sur "Mercedes". */
const MAKES = [
  'Mercedes-Benz', 'Rolls Royce', 'Alfa Romeo', 'Aston Martin', 'Land Rover',
  'Mercedes', 'Volkswagen', 'Mitsubishi', 'Chevrolet', 'Porsche', 'Bentley',
  'Ferrari', 'Maserati', 'Lamborghini', 'Jaguar', 'Renault', 'Peugeot',
  'Citroen', 'Citroën', 'Nissan', 'Toyota', 'Yamaha', 'Aprilia', 'Ducati',
  'Honda', 'Suzuki', 'Kawasaki', 'Subaru', 'Mazda', 'Lexus', 'Lotus',
  'Bugatti', 'Cadillac', 'Chrysler', 'Dodge', 'Austin', 'Triumph',
  'Audi', 'BMW', 'MINI', 'Mini', 'Ford', 'Saab', 'Volvo', 'Opel', 'Fiat',
  'Lancia', 'Seat', 'Skoda', 'Tesla', 'Alpine', 'Abarth',
];

/* Deux-roues : le type change le balisage schema.org (Motorcycle vs Car). */
const MOTORCYCLE_IDS = new Set([
  'yamaha-vmax-1200-145cv',
  'bmw-r-1200-cl',
  'honda-vfr800-fi-v4-800cc',
  'aprilia-mana-850-gt',
  'honda-integra-750-dct-2014-33-500-km',
]);
const MOTORCYCLE_HINTS = /\b(vmax|r ?1200|vfr\s?800|mana 850|integra 750|dct)\b/i;

/* La source contient des casses fantaisistes ("Bmw"). On recanonise. */
function canonicalMake(m) {
  if (!m) return null;
  const hit = MAKES.find((x) => x.toLowerCase() === String(m).trim().toLowerCase());
  return hit || String(m).trim();
}

function pickLang(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v.fr || v.en || null;
  return String(v) || null;
}

function splitTitle(title) {
  if (!title) return { make: null, model: null };
  const t = title.trim().replace(/\s+/g, ' ');
  for (const m of MAKES) {
    if (t.toLowerCase().startsWith(m.toLowerCase())) {
      const model = t.slice(m.length).trim().replace(/^[-–—]\s*/, '');
      return { make: m, model: model || null };
    }
  }
  const [first, ...rest] = t.split(' ');
  return { make: first || null, model: rest.join(' ') || null };
}

function slugify(s) {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const raw = JSON.parse(readFileSync(FILE, 'utf8'));
const seen = new Set();
const slugSeen = new Set();
const report = [];

const items = raw.items.map((it) => {
  const before = JSON.stringify(it);

  const titleFr = (it.title && it.title.fr) || null;
  const titleEn = (it.title && it.title.en) || titleFr;

  // make / model : on garde l'existant, sinon on derive du titre.
  let make = pickLang(it.make);
  let model = pickLang(it.model);
  if (!make || !model) {
    const d = splitTitle(titleFr || titleEn);
    make = make || d.make;
    model = model || d.model;
  }
  make = canonicalMake(make);

  // Prix : price_eur fait foi ; 0 et '' signifient "sur demande" -> null.
  let price = it.price_eur != null ? it.price_eur : it.price;
  price = price === '' || price === 0 ? null : price;
  price = price == null ? null : Number(price);
  if (Number.isNaN(price)) price = null;

  // Kilometrage : chaine libre cote admin, entier cote donnee.
  let mileage = it.mileage != null && it.mileage !== '' ? it.mileage : it.mileage_km;
  let mileageKm = null;
  if (mileage != null && mileage !== '') {
    const n = parseInt(String(mileage).replace(/[^\d]/g, ''), 10);
    if (!Number.isNaN(n) && n > 0) mileageKm = n;
  }

  const country = (it.country && it.country !== '' ? it.country : pickLang(it.location)) || null;

  // Identifiant stable : on ne le regenere jamais, il sert d'URL.
  let id = it.id || slugify([titleFr, it.year].filter(Boolean).join(' '));
  if (seen.has(id)) {
    let n = 2;
    while (seen.has(`${id}-${n}`)) n++;
    id = `${id}-${n}`;
    report.push(`  ! identifiant duplique corrige -> ${id}`);
  }
  seen.add(id);

  const isMoto = MOTORCYCLE_IDS.has(id) || MOTORCYCLE_HINTS.test(titleFr || '');

  /* L'id sert de cle etrangere aux reservations (colonne vehicle_slug) et
     contient des libelles libres ("rr sw", "mustang gt 2005") : il ne peut pas
     servir d'URL. On ajoute un slug dedie, ecrit une fois puis jamais
     regenere, pour qu'une URL publiee ne se casse pas si le titre change. */
  let slug = it.slug || slugify([make, model, it.year].filter(Boolean).join(' ')) || slugify(id);
  if (slugSeen.has(slug)) {
    let n = 2;
    while (slugSeen.has(`${slug}-${n}`)) n++;
    slug = `${slug}-${n}`;
  }
  slugSeen.add(slug);

  const out = {
    id,
    slug,
    vehicle_type: isMoto ? 'motorcycle' : 'car',
    make: make || null,
    model: model || null,
    year: it.year != null ? Number(it.year) : null,
    title: { fr: titleFr, en: titleEn },
    headline: it.headline && (it.headline.fr || it.headline.en)
      ? { fr: pickLang(it.headline), en: (it.headline.en || it.headline.fr) }
      : null,
    description: {
      fr: (it.description && it.description.fr) || '',
      en: (it.description && it.description.en) || '',
    },
    price_eur: price,
    mileage: mileage != null && mileage !== '' ? String(mileage) : '',
    mileage_km: mileageKm,
    country: country || '',
    status: it.status || 'available',
    sale_category: it.sale_category || 'both',
    // Chemins d'images normalises : le fichier melangeait "assets/..." et "/assets/...".
    images: (it.images || []).map((p) => '/' + String(p).replace(/^\/+/, '')),
  };

  if (JSON.stringify(out) !== before) {
    report.push(`  ${String(out.id).padEnd(28)} -> /${out.slug}`);
  }
  return out;
});

const incomplete = items.filter((i) => !i.year || !i.model || !i.images.length);

console.log(`${items.length} fiches normalisees`);
report.forEach((l) => console.log(l));
if (incomplete.length) {
  console.log(`\n${incomplete.length} fiche(s) incompletes (a completer dans l'admin) :`);
  incomplete.forEach((i) => console.log(
    `  ${i.id} — ${[!i.year && 'annee', !i.model && 'modele', !i.images.length && 'photos'].filter(Boolean).join(', ')}`));
}

if (!dry) {
  writeFileSync(FILE, JSON.stringify({ items }, null, 2) + '\n');
  console.log('\nassets/stock/stock.json reecrit');
} else {
  console.log('\n(--dry : aucun fichier ecrit)');
}
