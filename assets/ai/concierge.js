(function () {
  'use strict';

  var form = document.getElementById('conciergeForm');
  if (!form) return;

  var input = document.getElementById('conciergeQuery');
  var btn = document.getElementById('conciergeBtn');
  var out = document.getElementById('conciergeResult');
  var status = document.getElementById('conciergeStatus');
  var lang = document.documentElement.lang === 'en' ? 'en' : 'fr';

  var T = lang === 'en' ? {
    sending: 'Analysing…', send: 'Analyse my request',
    brief: 'Your brief', questions: 'To refine the search',
    matches: 'From current stock', nomatch: 'Nothing in stock matches',
    mustHave: 'Non-negotiable', niceToHave: 'Preferred',
    budget: 'Budget', years: 'Years', gearbox: 'Gearbox', use: 'Intended use',
    match: 'match', see: 'View in stock', contact: 'Send this brief to the team',
    err: 'The assistant is unavailable right now. Please use the contact form.',
    short: 'Please describe your search in a little more detail.'
  } : {
    sending: 'Analyse en cours…', send: 'Analyser ma demande',
    brief: 'Votre brief', questions: 'Pour affiner la recherche',
    matches: 'Dans le stock actuel', nomatch: 'Rien dans le stock ne correspond',
    mustHave: 'Non négociable', niceToHave: 'Souhaité',
    budget: 'Budget', years: 'Années', gearbox: 'Boîte', use: 'Usage',
    match: 'correspondance', see: 'Voir dans le stock', contact: 'Transmettre ce brief à l’équipe',
    err: 'L’assistant est momentanément indisponible. Merci d’utiliser le formulaire de contact.',
    short: 'Merci de décrire votre recherche en quelques mots de plus.'
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

  function chips(label, arr) {
    if (!arr || !arr.length) return '';
    return '<div class="aiChipRow"><span class="aiChipLabel">' + esc(label) + '</span>' +
      arr.map(function (x) { return '<span class="badge">' + esc(x) + '</span>'; }).join('') + '</div>';
  }

  function render(data) {
    var b = data.brief || {};
    var html = '';

    html += '<div class="card pad-md aiBlock">';
    html += '<div class="kicker">' + esc(T.brief) + '</div>';
    html += '<p class="aiSummary">' + esc(b.summary) + '</p>';

    var facts = [];
    if (b.budget_eur_max != null) facts.push([T.budget, '≤ ' + eur(b.budget_eur_max)]);
    if (b.year_min || b.year_max) facts.push([T.years, (b.year_min || '…') + ' – ' + (b.year_max || '…')]);
    if (b.transmission && b.transmission !== 'indifferent') facts.push([T.gearbox, b.transmission]);
    if (b.usage) facts.push([T.use, b.usage]);
    if (facts.length) {
      html += '<dl class="aiFacts">' + facts.map(function (f) {
        return '<dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd>';
      }).join('') + '</dl>';
    }

    html += chips(T.mustHave, b.must_have);
    html += chips(T.niceToHave, b.nice_to_have);
    html += '</div>';

    if (b.matches && b.matches.length) {
      html += '<div class="card pad-md aiBlock"><div class="kicker">' + esc(T.matches) + '</div><div class="aiMatches">';
      b.matches.forEach(function (m) {
        var v = m.vehicle || {};
        html += '<div class="aiMatch">' +
          '<div class="aiMatchHead">' +
            '<span class="aiMatchTitle">' + esc(v.title || v.id) + (v.year ? ' <span class="aiMatchYear">' + esc(v.year) + '</span>' : '') + '</span>' +
            '<span class="aiScore" title="' + esc(T.match) + '">' + Math.round(m.score) + '</span>' +
          '</div>' +
          '<div class="aiMatchMeta">' + esc(v.price_eur ? eur(v.price_eur) : (lang === 'en' ? 'Price on request' : 'Prix sur demande')) +
            (v.location ? ' · ' + esc(v.location) : '') + '</div>' +
          '<p class="aiMatchWhy">' + esc(m.why) + '</p>' +
        '</div>';
      });
      html += '</div><a class="btn" href="stock.html">' + esc(T.see) + '</a></div>';
    } else {
      html += '<div class="card pad-md aiBlock"><div class="kicker">' + esc(T.nomatch) + '</div>' +
        '<p class="aiSummary">' + esc(b.no_match_advice) + '</p></div>';
    }

    if (b.open_questions && b.open_questions.length) {
      html += '<div class="card pad-md aiBlock"><div class="kicker">' + esc(T.questions) + '</div>' +
        '<ul class="aiList">' + b.open_questions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ul></div>';
    }

    html += '<div class="aiDisclaimer">' + esc(lang === 'en' ? data.disclaimer_en : data.disclaimer_fr) + '</div>';
    html += '<a class="btn primary" href="contact.html?brief=1" onclick="plausible(\'Lead\')">' + esc(T.contact) + '</a>';

    out.innerHTML = html;
    // Le brief est repris tel quel dans le formulaire de contact.
    try { sessionStorage.setItem('bespoke_brief', input.value.trim()); } catch (_) {}
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
      var res = await fetch('/.netlify/functions/ai-concierge', {
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
      if (window.plausible) plausible('AI Concierge');
      render(data);
    } catch (_) {
      out.innerHTML = '';
      setStatus(T.err, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = T.send;
    }
  });

  // Exemples cliquables
  document.querySelectorAll('[data-example]').forEach(function (el) {
    el.addEventListener('click', function () {
      input.value = el.getAttribute('data-example');
      input.focus();
    });
  });
})();
