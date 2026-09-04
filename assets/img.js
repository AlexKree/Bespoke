/**
 * Resolution des images cote client.
 *
 * Les variantes WebP sont produites au build par scripts/build-images.mjs et
 * servies en fichiers statiques : aucune conversion a l'execution, donc pas de
 * latence pour le premier visiteur.
 *
 * Repli : une photo ajoutee depuis l'admin apres le dernier deploiement n'a
 * pas encore de variante. On bascule alors sur l'Image CDN de Netlify, le
 * temps que le prochain build la produise.
 */
(function (w) {
  'use strict';

  function norm(p) { return '/' + String(p == null ? '' : p).replace(/^\/+/, ''); }

  function variant(src, width) {
    var p = norm(src).replace(/^\/assets\//, '');
    return '/assets/_img/' + p.replace(/\.[^.\/]+$/, '') + '-' + width + '.webp';
  }

  function cdn(src, width, quality) {
    return '/.netlify/images?url=' + encodeURIComponent(norm(src)) +
           '&w=' + width + '&fm=webp&q=' + (quality || 72);
  }

  function srcset(src, widths) {
    return widths.map(function (x) { return variant(src, x) + ' ' + x + 'w'; }).join(', ');
  }

  /** Applique la variante statique a une <img>, avec repli automatique. */
  function apply(img, src, width, widths, sizes) {
    if (!src) return;
    img.src = variant(src, width);
    if (widths) img.srcset = srcset(src, widths);
    if (sizes) img.sizes = sizes;
    img.addEventListener('error', function onErr() {
      img.removeEventListener('error', onErr);
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
      img.src = cdn(src, width);
    });
  }

  w.BespokeImg = { variant: variant, cdn: cdn, srcset: srcset, apply: apply };
})(window);
