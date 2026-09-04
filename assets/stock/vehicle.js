(function () {
  'use strict';

  // Galerie de la fiche vehicule : la vignette cliquee remplace l'image principale.
  var main = document.getElementById('vpMain');
  var thumbs = document.querySelectorAll('.vpThumb');
  if (!main || !thumbs.length) return;

  function select(btn) {
    var full = btn.getAttribute('data-full');
    if (!full) return;
    main.removeAttribute('srcset'); // sinon le navigateur garde l'ancienne source
    main.removeAttribute('sizes');
    main.src = full;
    thumbs.forEach(function (t) { t.classList.remove('active'); });
    btn.classList.add('active');
  }

  thumbs.forEach(function (btn, i) {
    btn.addEventListener('click', function () { select(btn); });
    btn.addEventListener('keydown', function (e) {
      var next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
      if (next == null) return;
      e.preventDefault();
      var target = thumbs[(next + thumbs.length) % thumbs.length];
      target.focus();
      select(target);
    });
  });
})();
