(function () {
  'use strict';

  var form = document.getElementById('importForm');
  if (!form) return;

  var input = document.getElementById('importQuery');
  var btn = document.getElementById('importBtn');
  var out = document.getElementById('importResult');
  var status = document.getElementById('importStatus');
  var lang = document.documentElement.lang === 'en' ? 'en' : 'fr';

  var T = lang === 'en' ? {
    sending: 'Calculating…', send: 'Estimate the landed cost',
    breakdown: 'Cost breakdown', total: 'Total landed cost',
    extra: 'On top of the purchase price', steps: 'How it unfolds',
    docs: 'Documents to gather', timeline: 'Realistic timeline',
    risks: 'What could move the figure', assumptions: 'Assumptions made',
    missing: 'What would sharpen this estimate',
    partialTotal: 'Partial total — some lines not costed',
    err: 'The calculator is unavailable right now. Please use the contact form.',
    short: 'Describe the vehicle, where it comes from and its price.',
    ask: 'Ask us to confirm this costing'
  } : {
    sending: 'Calcul en cours…', send: 'Estimer le coût total',
    breakdown: 'Détail du chiffrage', total: 'Coût total rendu en France',
    extra: 'En sus du prix d’achat', steps: 'Déroulé de l’opération',
    docs: 'Documents à réunir', timeline: 'Délai réaliste',
    risks: 'Ce qui peut faire bouger le chiffre', assumptions: 'Hypothèses retenues',
    missing: 'Ce qui affinerait l’estimation',
    partialTotal: 'Total partiel — certains postes non chiffrés',
    err: 'Le calculateur est momentanément indisponible. Merci d’utiliser le formulaire de contact.',
    short: 'Décrivez le véhicule, son pays de départ et son prix.',
    ask: 'Faire confirmer ce chiffrage'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function eur(n) {
    if (n == null) return '—';
    try { return new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n); }
    catch (_) { return n + ' €'; }
  }

  function setStatus(msg, type) {
    if (!msg) { status.style.display = 'none'; return; }
    status.textContent = msg;
    status.className = 'authMsg ' + (type || 'error');
    status.style.display = 'block';
  }

  function list(title, arr, cls) {
    if (!arr || !arr.length) return '';
    return '<div class="card pad-md aiBlock"><div class="kicker">' + esc(title) + '</div>' +
      '<ul class="aiList ' + (cls || '') + '">' +
      arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
  }

  function render(data) {
    var c = data.costing || {};
    var x = data.explanation || {};
    var p = data.params || {};
    var html = '';

    if (x.headline) {
      html += '<div class="card pad-md aiBlock"><div class="kicker">' + esc(p.vehicle_label || '') + '</div>' +
        '<p class="aiSummary">' + esc(x.headline) + '</p></div>';
    }

    // Chiffrage
    html += '<div class="card pad-md aiBlock"><div class="kicker">' + esc(T.breakdown) + '</div><table class="aiTable">';
    (c.lines || []).forEach(function (l) {
      html += '<tr><th scope="row">' + esc(lang === 'en' ? l.label_en : l.label_fr) + '</th>' +
        '<td>' + esc(eur(l.amount)) + '</td></tr>';
    });
    html += '<tr class="aiTableTotal"><th scope="row">' + esc(c.partial ? T.partialTotal : T.total) + '</th><td>' + esc(eur(c.total_eur)) + '</td></tr>';
    html += '</table>';
    if (c.extra_over_price_eur != null) {
      html += '<div class="aiExtra">' + esc(T.extra) + ' : <strong>' + esc(eur(c.extra_over_price_eur)) + '</strong>' +
        (c.extra_ratio != null ? ' <span class="aiExtraPct">(+' + Math.round(c.extra_ratio * 100) + ' %)</span>' : '') + '</div>';
    }
    (c.notes || []).forEach(function (n) {
      html += '<div class="aiNote aiNote--' + esc(n.level) + '">' + esc(lang === 'en' ? n.en : n.fr) + '</div>';
    });
    html += '</div>';

    if (x.steps && x.steps.length) {
      html += '<div class="card pad-md aiBlock"><div class="kicker">' + esc(T.steps) + '</div><ol class="aiSteps">';
      x.steps.forEach(function (s) {
        html += '<li><strong>' + esc(s.title) + '</strong><span>' + esc(s.detail) + '</span></li>';
      });
      html += '</ol>';
      if (x.timeline_weeks) {
        html += '<div class="aiTimeline">' + esc(T.timeline) + ' : <strong>' + esc(x.timeline_weeks) + '</strong></div>';
      }
      html += '</div>';
    }

    html += list(T.docs, x.documents);
    html += list(T.risks, x.risks, 'aiList--warn');
    html += list(T.assumptions, p.assumptions);
    html += list(T.missing, p.missing);

    html += '<div class="aiDisclaimer">' + esc(lang === 'en' ? data.disclaimer_en : data.disclaimer_fr) + '</div>';
    html += '<a class="btn primary" href="contact.html" onclick="plausible(\'Lead\')">' + esc(T.ask) + '</a>';

    out.innerHTML = html;
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    setStatus('');
    var query = input.value.trim();
    if (query.length < 10) { setStatus(T.short, 'error'); return; }

    btn.disabled = true;
    btn.textContent = T.sending;
    out.innerHTML = '<div class="aiSkeleton"><span></span><span></span><span></span></div>';

    try {
      var res = await fetch('/.netlify/functions/ai-import-cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query, lang: lang }),
      });
      var data = await res.json();
      if (!res.ok || !data.ok) {
        out.innerHTML = '';
        setStatus((lang === 'en' ? data.message_en : data.message_fr) || T.err, 'error');
        return;
      }
      if (data.needs_price) {
        out.innerHTML = '';
        setStatus(lang === 'en' ? data.message_en : data.message_fr, 'error');
        return;
      }
      if (window.plausible) plausible('AI Import Cost');
      render(data);
    } catch (_) {
      out.innerHTML = '';
      setStatus(T.err, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = T.send;
    }
  });

  document.querySelectorAll('[data-example]').forEach(function (el) {
    el.addEventListener('click', function () {
      input.value = el.getAttribute('data-example');
      input.focus();
    });
  });
})();
