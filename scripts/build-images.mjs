#!/usr/bin/env node
/**
 * Pre-genere les variantes WebP servies par le site.
 *
 * Pourquoi : les images passaient par l'Image CDN Netlify, qui convertit a la
 * demande. La premiere requete sur chaque variante payait la conversion, ce
 * qui rendait la page stock et les fiches vehicule tres lentes pour un
 * visiteur arrivant le premier. Ici tout est produit au build : le site ne
 * sert plus que des fichiers statiques.
 *
 * Sortie :
 *   assets/_img/<chemin-source-sans-extension>-<largeur>.webp
 *   assets/_img/manifest.json   (consomme par stock.js et gallery.js)
 *
 * On ne genere que les couples (image, largeur) reellement demandes par le
 * site : produire une echelle complete pour 300 images ferait des centaines
 * de Mo inutiles.
 *
 *   node scripts/build-images.mjs [--force]
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets/_img');
const QUALITY = 76;
const force = process.argv.includes('--force');

/* ── Largeurs par usage ───────────────────────────────────────────────
   Doivent rester alignees sur les attributs sizes/srcset du site.       */
const WIDTHS = {
  logo: [88, 176],                 // navbar, 44 px affiches
  hero: [400, 640, 900, 1040],     // .media
  tile: [400, 640, 760],           // .tile et .car-photo-card
  stockCard: [400, 560, 760],      // vignette de carte stock
  stockModal: [500, 760, 1000],    // image principale de la modale
  thumb: [160],                    // vignettes de modale
  galleryThumb: [300, 450, 600],
  galleryFull: [1600],
};

/** Chemin de sortie pour une source du site et une largeur. */
function variantPath(sitePath, w) {
  const rel = sitePath.replace(/^\/+/, '').replace(/^assets\//, '');
  return `/assets/_img/${rel.slice(0, rel.length - extname(rel).length)}-${w}.webp`;
}

/* ── Inventaire des couples (image, largeur) a produire ───────────────── */

const wanted = new Map(); // chemin site -> Set(largeurs)
function want(sitePath, widths) {
  if (!sitePath) return;
  const key = '/' + String(sitePath).replace(/^\/+/, '');
  if (!wanted.has(key)) wanted.set(key, new Set());
  for (const w of widths) wanted.get(key).add(w);
}

// 1. Images des pages HTML, largeur deduite du contexte CSS.
/** Retrouve la source d'origine et la largeur derriere une variante _img. */
function sourceOfVariant(p, exts) {
  const m = p.match(/^\/assets\/_img\/(.+)-(\d+)\.webp$/);
  if (!m) return null;
  for (const ext of exts) {
    const cand = `/assets/${m[1]}${ext}`;
    if (existsSync(join(ROOT, cand.slice(1)))) return { src: cand, width: Number(m[2]) };
  }
  return null;
}
const EXTS = ['.jpg', '.jpeg', '.png', '.JPG', '.JPEG', '.PNG'];

function scanHtml(file) {
  const html = readFileSync(file, 'utf8');
  for (const m of html.matchAll(/<img\b[^>]*?>/g)) {
    const tag = m[0];

    // src ET srcset : ne lire que src laisserait les autres largeurs du
    // srcset non generees des le second build — l'arbre est alors deja
    // converti, et le contexte CSS ne suffit plus a les deviner.
    const urls = [];
    const srcAttr = tag.match(/\ssrc="([^"]+)"/);
    if (srcAttr) urls.push(srcAttr[1]);
    const setAttr = tag.match(/\ssrcset="([^"]+)"/);
    if (setAttr) {
      for (const cand of setAttr[1].split(',')) {
        const u = cand.trim().split(/\s+/)[0];
        if (u) urls.push(u);
      }
    }
    if (!urls.length) continue;

    const before = html.slice(Math.max(0, m.index - 300), m.index);
    const contextWidths = tag.includes('class="mark"') ? WIDTHS.logo
      : /class="[^"]*\bmedia\b/.test(before) ? WIDTHS.hero
      : WIDTHS.tile;

    for (let p of urls) {
      const cdnMatch = p.match(/\/\.netlify\/images\?url=([^"&]+)/);
      if (cdnMatch) p = decodeURIComponent(cdnMatch[1]);
      if (/^https?:|^data:/.test(p)) continue;
      p = p.replace(/^(\.\.\/)+/, '/');
      if (!p.startsWith('/assets/')) continue;

      if (p.startsWith('/assets/_img/')) {
        // Arbre deja converti : on remonte a la source, et on demande a la
        // fois la largeur lue et l'echelle complete de son contexte.
        const back = sourceOfVariant(p, EXTS);
        if (back) want(back.src, [back.width, ...contextWidths]);
        continue;
      }
      want(p, contextWidths);
    }
  }
}
function walkHtml(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkHtml(p);
    else if (e.name.endsWith('.html')) scanHtml(p);
  }
}
for (const d of ['fr', 'en']) walkHtml(join(ROOT, d));
scanHtml(join(ROOT, 'index.html'));

// 2. Catalogue : la premiere image sert de vignette de carte, toutes les
//    images servent dans la modale.
const stock = JSON.parse(readFileSync(join(ROOT, 'assets/stock/stock.json'), 'utf8'));
for (const item of stock.items || []) {
  (item.images || []).forEach((p, i) => {
    want(p, WIDTHS.thumb);
    want(p, WIDTHS.stockModal);
    if (i === 0) want(p, WIDTHS.stockCard);
  });
}

// 3. Galerie.
const galleryFile = join(ROOT, 'assets/gallery/gallery.json');
if (existsSync(galleryFile)) {
  const g = JSON.parse(readFileSync(galleryFile, 'utf8'));
  for (const it of g.items || []) {
    want(it.thumb, WIDTHS.galleryThumb);
    want(it.file, WIDTHS.galleryFull);
  }
}

/* ── Generation ───────────────────────────────────────────────────────── */

const manifest = {};
let made = 0, reused = 0, missing = 0, bytes = 0;

for (const [sitePath, widths] of [...wanted].sort()) {
  const abs = join(ROOT, sitePath.replace(/^\/+/, ''));
  if (!existsSync(abs)) { missing++; continue; }
  const srcStat = statSync(abs);
  let meta;
  try { meta = await sharp(abs).metadata(); } catch (_) { missing++; continue; }

  const done = [];
  for (const w of [...widths].sort((a, b) => a - b)) {
    const target = Math.min(w, meta.width); // ne jamais agrandir
    const outAbs = join(ROOT, variantPath(sitePath, w).replace(/^\/+/, ''));
    mkdirSync(dirname(outAbs), { recursive: true });

    if (!force && existsSync(outAbs) && statSync(outAbs).mtimeMs > srcStat.mtimeMs) {
      reused++; bytes += statSync(outAbs).size; done.push(w); continue;
    }
    await sharp(abs).rotate().resize({ width: target, withoutEnlargement: true })
      .webp({ quality: QUALITY }).toFile(outAbs);
    made++; bytes += statSync(outAbs).size; done.push(w);
  }
  manifest[sitePath] = done;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest));

console.log(`${wanted.size} images sources · ${made} variantes generees · ${reused} reutilisees`);
console.log(`poids total des variantes : ${(bytes / 1024 / 1024).toFixed(1)} Mo`);
if (missing) console.log(`${missing} source(s) introuvable(s), ignoree(s)`);
