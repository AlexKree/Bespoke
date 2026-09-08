(function () {
  'use strict';

  var form = document.getElementById('inspectionForm');
  if (!form) return;

  var fileInput = document.getElementById('inspectionFiles');
  var drop = document.getElementById('inspectionDrop');
  var thumbs = document.getElementById('inspectionThumbs');
  var context = document.getElementById('inspectionContext');
  var urlInput = document.getElementById('inspectionUrl');
  var btn = document.getElementById('inspectionBtn');
  var out = document.getElementById('inspectionResult');
  var status = document.getElementById('inspectionStatus');
  var lang = document.documentElement.lang === 'en' ? 'en' : 'fr';

  var MAX_FILES = 6;
  var MAX_EDGE = 1200;   // px — suffisant pour l'analyse visuelle
  var QUALITY = 0.74;
  // Netlify rejette a la peripherie (HTTP 413) toute requete de fonction au-dela
  // de 6 Mo, base64 compris. On vise large en dessous : si le lot depasse, on
  // recompresse par paliers avant l'envoi (ensurePayloadUnder).
  var PAYLOAD_LIMIT = 3.8 * 1024 * 1024;

  var T = lang === 'en' ? {
    sending: 'Analysing photos…', send: 'Generate the pre-report',
    id: 'What the photos show', quality: 'What these photos allow',
    obs: 'Observations', checks: 'To check physically',
    questions: 'Questions for the seller', docs: 'Documents to request',
    overall: 'Summary', remove: 'Remove', source: 'Listing',
    sev: { info: 'Note', attention: 'To watch', alerte: 'Alert' },
    err: 'The analysis is unavailable right now. Please use the contact form.',
    slow: 'Analysing several photos — this can take up to a minute. Keep this tab open.',
    none: 'Add at least one photo.', tooMany: 'Maximum ' + MAX_FILES + ' photos.',
    notImage: 'Only JPEG, PNG and WebP images are accepted.',
    badUrl: 'The listing link must start with http:// or https://.',
    ask: 'Have Bespoke inspect this car',
    count: function (n) { return n + ' / ' + MAX_FILES + ' photos'; }
  } : {
    sending: 'Analyse des photos…', send: 'Générer le pré-rapport',
    id: 'Ce que montrent les photos', quality: 'Ce que ces photos permettent',
    obs: 'Observations', checks: 'À vérifier physiquement',
    questions: 'Questions à poser au vendeur', docs: 'Documents à demander',
    overall: 'Synthèse', remove: 'Retirer', source: 'Annonce',
    sev: { info: 'Note', attention: 'À surveiller', alerte: 'Alerte' },
    err: 'L’analyse est momentanément indisponible. Merci d’utiliser le formulaire de contact.',
    slow: 'Analyse de plusieurs photos en cours — cela peut prendre jusqu’à une minute. Gardez cet onglet ouvert.',
    none: 'Ajoutez au moins une photo.', tooMany: 'Maximum ' + MAX_FILES + ' photos.',
    notImage: 'Seules les images JPEG, PNG et WebP sont acceptées.',
    badUrl: 'Le lien de l’annonce doit commencer par http:// ou https://.',
    ask: 'Faire inspecter ce véhicule par Bespoke',
    count: function (n) { return n + ' / ' + MAX_FILES + ' photos'; }
  };

  var files = []; // { name, dataUrl, base64, media_type }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function setStatus(msg, type) {
    if (!msg) { status.style.display = 'none'; return; }
    status.textContent = msg;
    status.className = 'authMsg ' + (type || 'error');
    status.style.display = 'block';
  }

  function toJpeg(source, w, h) {
    var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', QUALITY);
  }

  /** Redimensionne dans le navigateur : la photo brute d'un telephone (5-10 Mo)
      devient ~200 Ko, ce qui divise d'autant le cout d'analyse et le temps d'upload.
      L'orientation EXIF est redressee : une photo couchee degrade nettement l'analyse. */
  async function shrink(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        var bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        var url0 = toJpeg(bmp, bmp.width, bmp.height);
        bmp.close();
        return { name: file.name, dataUrl: url0, base64: url0.split(',')[1], media_type: 'image/jpeg' };
      } catch (_) { /* repli sur <img> ci-dessous */ }
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var dataUrl = toJpeg(img, img.naturalWidth, img.naturalHeight);
        resolve({ name: file.name, dataUrl: dataUrl, base64: dataUrl.split(',')[1], media_type: 'image/jpeg' });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function payloadBytes() {
    return files.reduce(function (n, f) { return n + f.base64.length * 0.75; }, 0);
  }

  function reencode(dataUrl, edge, quality) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () { reject(new Error('reencode')); };
      img.src = dataUrl;
    });
  }

  /** Garantit que le lot tient sous PAYLOAD_LIMIT : recompresse toutes les photos
      par paliers de plus en plus serres jusqu'a y arriver. Sans effet si le lot
      est deja assez leger (cas courant a 1200 px / q0.74). */
  async function ensurePayloadUnder() {
    var steps = [[1100, 0.7], [1000, 0.64], [900, 0.58], [800, 0.5]];
    for (var s = 0; s < steps.length && payloadBytes() > PAYLOAD_LIMIT; s++) {
      for (var i = 0; i < files.length; i++) {
        var u = await reencode(files[i].dataUrl, steps[s][0], steps[s][1]);
        files[i].dataUrl = u;
        files[i].base64 = u.split(',')[1];
      }
    }
  }

  function renderThumbs() {
    thumbs.innerHTML = files.map(function (f, i) {
      return '<div class="aiThumb"><img src="' + f.dataUrl + '" alt=""/>' +
        '<button type="button" class="aiThumbX" data-remove="' + i + '" aria-label="' + esc(T.remove) + '">×</button></div>';
    }).join('') + (files.length ? '<div class="aiThumbCount">' + esc(T.count(files.length)) + '</div>' : '');
  }

  async function addFiles(list) {
    setStatus('');
    for (var i = 0; i < list.length; i++) {
      if (files.length >= MAX_FILES) { setStatus(T.tooMany, 'error'); break; }
      var f = list[i];
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { setStatus(T.notImage, 'error'); continue; }
      try { files.push(await shrink(f)); } catch (_) { setStatus(T.notImage, 'error'); }
    }
    renderThumbs();
  }

  fileInput.addEventListener('change', function () { addFiles(fileInput.files); fileInput.value = ''; });

  thumbs.addEventListener('click', function (e) {
    var b = e.target.closest('[data-remove]');
    if (!b) return;
    files.splice(Number(b.getAttribute('data-remove')), 1);
    renderThumbs();
  });

  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  function clean(arr) {
    return (Array.isArray(arr) ? arr : [])
      .map(function (x) { return typeof x === 'string' ? x.trim() : ''; })
      .filter(Boolean);
  }

  function list(title, arr, cls) {
    var items = clean(arr);
    if (!items.length) return '';
    return '<div class="card pad-md aiBlock"><div class="kicker">' + esc(title) + '</div>' +
      '<ul class="aiList ' + (cls || '') + '">' +
      items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
  }

  function hostOf(u) {
    try { return new URL(u).host.replace(/^www\./, ''); } catch (_) { return u; }
  }

  function render(data) {
    var r = data.report || {};
    var html = '';

    var ident = (r.identification || '').trim();
    html += '<div class="card pad-md aiBlock"><div class="kicker">' + esc(T.id) + '</div>' +
      '<p class="aiSummary">' + esc(ident || (lang === 'en' ? 'The photos could not be read.' : 'Les photos n’ont pas pu être exploitées.')) + '</p>' +
      ((r.photo_quality || '').trim() ? '<p class="aiMuted"><strong>' + esc(T.quality) + '</strong> — ' + esc(r.photo_quality.trim()) + '</p>' : '') +
      (data.listing_url ? '<p class="aiMuted"><strong>' + esc(T.source) + '</strong> — <a href="' + esc(data.listing_url) +
        '" target="_blank" rel="noopener noreferrer nofollow">' + esc(hostOf(data.listing_url)) + '</a></p>' : '') +
      '</div>';

    var obs = (Array.isArray(r.observations) ? r.observations : [])
      .filter(function (o) { return o && typeof o.finding === 'string' && o.finding.trim(); });
    if (obs.length) {
      html += '<div class="card pad-md aiBlock"><div class="kicker">' + esc(T.obs) + '</div><div class="aiObs">';
      obs.forEach(function (o) {
        html += '<div class="aiObsRow aiObsRow--' + esc(o.severity) + '">' +
          '<span class="aiSev">' + esc((T.sev[o.severity]) || o.severity) + '</span>' +
          '<div><div class="aiObsZone">' + esc((o.zone || '').trim()) + '</div>' +
          '<p>' + esc(o.finding.trim()) + '</p></div></div>';
      });
      html += '</div></div>';
    }

    html += list(T.checks, r.checks);
    html += list(T.questions, r.questions_for_seller);
    html += list(T.docs, r.documents_to_request);

    if ((r.overall || '').trim()) {
      html += '<div class="card pad-md aiBlock"><div class="kicker">' + esc(T.overall) + '</div>' +
        '<p class="aiSummary">' + esc(r.overall.trim()) + '</p></div>';
    }

    html += '<div class="aiDisclaimer">' + esc(lang === 'en' ? data.disclaimer_en : data.disclaimer_fr) + '</div>';
    html += '<a class="btn primary" href="contact.html" onclick="plausible(\'Lead\')">' + esc(T.ask) + '</a>';

    out.innerHTML = html;
    // Repris par le formulaire de contact quand le pre-remplissage sera en place.
    try {
      if (data.listing_url) sessionStorage.setItem('bespoke_listing_url', data.listing_url);
      else sessionStorage.removeItem('bespoke_listing_url');
    } catch (_) {}
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // L'analyse de plusieurs photos depasse le budget temps d'une fonction Netlify
  // synchrone : elle tourne dans une fonction "background" et la page interroge
  // ai-inspection-status jusqu'a ce que le rapport soit pret.
  var POLL_MS = 2500;
  var POLL_MAX_MS = 300000; // au-dela, on abandonne cote client (la fonction a 15 min)

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    setStatus('');
    if (!files.length) { setStatus(T.none, 'error'); return; }

    var listingUrl = (urlInput && urlInput.value.trim()) || '';
    if (listingUrl && !/^https?:\/\/.+/i.test(listingUrl)) { setStatus(T.badUrl, 'error'); return; }

    btn.disabled = true;
    btn.textContent = T.sending;
    out.innerHTML = '<div class="aiSkeleton"><span></span><span></span><span></span><span></span></div>';

    var jobId = uuid();
    var started = Date.now();
    var slowNoteShown = false;

    function done() { btn.disabled = false; btn.textContent = T.send; }
    function failOut(msg) { done(); out.innerHTML = ''; setStatus(msg || T.err, 'error'); }

    function poll() {
      fetch('/.netlify/functions/ai-inspection-status?id=' + encodeURIComponent(jobId), { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.status === 'done') {
            if (window.plausible) plausible('AI Inspection');
            setStatus('');
            done();
            render(data);
            return;
          }
          if (data.status === 'error') {
            var m = (lang === 'en' ? data.message_en : data.message_fr) || T.err;
            if (data.error_code) m += ' [' + data.error_code + (data.detail ? ': ' + data.detail : '') + ']';
            failOut(m);
            return;
          }
          if (Date.now() - started > POLL_MAX_MS) { failOut(); return; }
          if (!slowNoteShown && Date.now() - started > 20000) {
            slowNoteShown = true;
            setStatus(T.slow, 'info');
          }
          setTimeout(poll, POLL_MS);
        })
        .catch(function () {
          if (Date.now() - started > POLL_MAX_MS) failOut();
          else setTimeout(poll, POLL_MS);
        });
    }

    try {
      await ensurePayloadUnder();
    } catch (_) { /* on tente l'envoi tel quel */ }

    try {
      var res = await fetch('/.netlify/functions/ai-inspection-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          lang: lang,
          context: context.value.trim(),
          listing_url: listingUrl,
          images: files.map(function (f) { return { media_type: f.media_type, data: f.base64 }; }),
        }),
      });
      // Fonction "background" : Netlify repond 202 sans corps. Tout autre code = le
      // lancement a echoue (payload trop gros a la peripherie, fonction absente...).
      if (res.status !== 202 && !res.ok) {
        var d = {};
        try { d = await res.json(); } catch (_) {}
        failOut(((lang === 'en' ? d.message_en : d.message_fr) || T.err) + ' [kickoff HTTP ' + res.status + ']');
        return;
      }
    } catch (_) {
      failOut();
      return;
    }

    poll();
  });
})();
