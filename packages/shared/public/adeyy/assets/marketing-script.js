(function() {
  'use strict';

  var qrStyle = { modules: 'square', eyes: 'square' };

  function toast(msg) {
    var el = document.createElement('div');
    el.className = 'atoast';
    el.innerHTML = '<span class="tdot"></span>' + msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(function () { el.remove(); }, 2600);
  }

  /* ----- decorative QRs (all real, all scannable) ----- */
  function renderDeco() {
    document.querySelectorAll('.deco-qr').forEach(function (el) {
      var fg = el.dataset.fg, bg = el.dataset.bg;
      if (el.dataset.accent) {
        fg = getComputedStyle(document.documentElement).getPropertyValue('--adeyy').trim() || fg;
      }
      el.innerHTML = AdeyyQR.svgString(el.dataset.text, {
        fg: fg || '#0E0E0C',
        bg: bg || '#FBFAF4',
        modules: qrStyle.modules,
        eyes: qrStyle.eyes,
        quiet: 3
      });
      var svg = el.querySelector('svg');
      if (svg) { svg.style.width = '100%'; svg.style.height = '100%'; svg.style.display = 'block'; }
    });
  }

  /* ----- hero motion graphic: scene-based explainer ----- */
  var FILM_SHORT_URL = 'https://adeyy.com/winter?s=q';
  var FILM_LONG = 'my-cafe.com.au/menus/winter-2026/specials';
  var FILM_DESTS = ['my-cafe.com.au/winter-menu', 'my-cafe.com.au/book-a-table', 'instagram.com/mycafe.au'];
  var FILM_CHIPS = ['Your menu', 'Bookings', 'Instagram', 'Reviews', 'Wi-Fi', 'Tap to pay', 'Playlist'];
  var FILM_PALS = [
    { fg: '#0E0E0C', bg: '#FBFAF4', sw: 0 },
    { fg: '#007d66', bg: '#FBFAF4', sw: 1 },
    { fg: '#0E0E0C', bg: '#D9F542', sw: 2 }
  ];
  var qrColors = { s2qr: { fg: '#0E0E0C', bg: '#FBFAF4' }, s3qr: { fg: '#0E0E0C', bg: '#FBFAF4' }, s4qr: { fg: '#0E0E0C', bg: '#FBFAF4' }, s6qr: { fg: '#0E0E0C', bg: '#FBFAF4' } };

  function paintQR(holderId, cfg) {
    var slot = document.querySelector('#' + holderId + ' .qrslot');
    if (!slot) return;
    slot.innerHTML = AdeyyQR.svgString(FILM_SHORT_URL, {
      fg: (cfg && cfg.fg) || '#0E0E0C', bg: (cfg && cfg.bg) || '#FBFAF4',
      modules: qrStyle.modules, eyes: qrStyle.eyes, quiet: 3
    });
    var svg = slot.querySelector('svg');
    if (svg) { svg.style.width = '100%'; svg.style.height = '100%'; svg.style.display = 'block'; }
  }
  function repaintAllQR() {
    Object.keys(qrColors).forEach(function (id) { if (document.getElementById(id)) paintQR(id, qrColors[id]); });
  }
  function scanFx(id) {
    var qr = document.getElementById(id);
    if (!qr) return;
    qr.classList.remove('scan'); void qr.offsetWidth; qr.classList.add('scan');
  }

  /* sub-timers cleared on every scene change */
  var filmSub = [];
  window.__adeyyClearSub = function clearSub() { filmSub.forEach(function (t) { clearTimeout(t); clearInterval(t); }); filmSub = []; }
  function later(fn, ms) { var t = setTimeout(fn, ms); filmSub.push(t); return t; }
  function every(fn, ms) { var t = setInterval(fn, ms); filmSub.push(t); return t; }

  function typeInto(el, text, speed) {
    el.textContent = '';
    var i = 0;
    every(function () { el.textContent = text.slice(0, ++i); if (i >= text.length) clearSub_one(); }, speed);
    function clearSub_one() {/* interval keeps ticking harmlessly until scene change clears it */}
  }

  function sceneEnter(n) {
    if (n === 0) {
      typeInto(document.getElementById('filmUrl'), FILM_LONG, 42);
    } else if (n === 1) {
      var sh = document.getElementById('filmShort1');
      sh.classList.remove('draw'); void sh.offsetWidth; sh.classList.add('draw');
    } else if (n === 2) {
      qrColors.s2qr = { fg: '#0E0E0C', bg: '#FBFAF4' }; paintQR('s2qr', qrColors.s2qr); scanFx('s2qr');
    } else if (n === 3) {
      var idx = 0;
      var apply = function () {
        var p = FILM_PALS[idx % FILM_PALS.length];
        qrColors.s3qr = { fg: p.fg, bg: p.bg }; paintQR('s3qr', qrColors.s3qr);
        document.querySelectorAll('#s3sw .sw').forEach(function (s, i) { s.classList.toggle('on', i === p.sw); });
        idx++;
      };
      apply(); every(apply, 950);
      var exps = document.querySelectorAll('#s3exports .film-exp'); var e = 0;
      var pulse = function () { exps.forEach(function (x) { x.classList.remove('hot'); }); if (exps[e % exps.length]) exps[e % exps.length].classList.add('hot'); e++; };
      pulse(); every(pulse, 760);
    } else if (n === 4) {
      qrColors.s4qr = { fg: '#0E0E0C', bg: '#FBFAF4' }; paintQR('s4qr', qrColors.s4qr);
      var di = 0;
      var swap = function () {
        var d = FILM_DESTS[di % FILM_DESTS.length];
        var t = document.getElementById('filmDestText'); t.textContent = d;
        t.classList.remove('enter'); void t.offsetWidth; t.classList.add('enter');
        var bar = document.getElementById('filmDest'); bar.classList.remove('flash'); void bar.offsetWidth; bar.classList.add('flash');
        later(function () { bar.classList.remove('flash'); }, 800);
        di++;
      };
      swap(); every(swap, 1150);
    } else if (n === 5) {
      var wrap = document.getElementById('filmChips'); wrap.innerHTML = '';
      FILM_CHIPS.forEach(function (c, i) {
        var el = document.createElement('span'); el.className = 'film-chip'; el.textContent = c; wrap.appendChild(el);
        later(function () { el.classList.add('in'); }, 95 * i);
      });
    } else if (n === 6) {
      qrColors.s6qr = { fg: '#0E0E0C', bg: '#FBFAF4' }; paintQR('s6qr', qrColors.s6qr); scanFx('s6qr');
    }
  }

  var FILM_DUR = [2600, 2400, 2500, 3600, 3700, 2700, 3000];
  var filmTimer = null, filmCur = 0;

  function paintSegs(n) {
    var segs = document.querySelectorAll('#filmSegs .fseg');
    segs.forEach(function (s, i) {
      s.classList.remove('done');
      var fill = s.querySelector('i');
      fill.style.transition = 'none'; fill.style.width = i < n ? '100%' : '0%';
      if (i < n) s.classList.add('done');
    });
    var active = segs[n];
    if (active) {
      var fill = active.querySelector('i');
      fill.style.transition = 'none'; fill.style.width = '0%'; void fill.offsetWidth;
      fill.style.transition = 'width ' + FILM_DUR[n] + 'ms linear'; fill.style.width = '100%';
    }
  }

  function setScene(n) {
    clearSub();
    filmCur = n;
    document.querySelectorAll('.film-scene').forEach(function (s) { s.classList.remove('on'); });
    var el = document.querySelector('.film-scene[data-scene="' + n + '"]');
    if (el) { el.classList.add('on'); }
    document.getElementById('filmStep').textContent = '0' + (n + 1) + ' / 0' + FILM_DUR.length;
    paintSegs(n);
    try { sceneEnter(n); } catch (e) {}
    filmTimer = setTimeout(function () { setScene((n + 1) % FILM_DUR.length); }, FILM_DUR[n]);
  }

  window.__adeyyInitFilm = function initFilm() {
    var segs = document.getElementById('filmSegs');
    if (segs && !segs.children.length) {
      for (var i = 0; i < FILM_DUR.length; i++) {
        var s = document.createElement('span'); s.className = 'fseg'; s.innerHTML = '<i></i>'; segs.appendChild(s);
      }
    }
    renderDeco();
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      /* static still: show the QR-code scene */
      document.querySelectorAll('.film-scene').forEach(function (s) { s.classList.remove('on'); });
      var el = document.querySelector('.film-scene[data-scene="2"]');
      if (el) el.classList.add('on');
      paintQR('s2qr', qrColors.s2qr);
      document.getElementById('filmStep').textContent = 'How it works';
      var fs = document.querySelectorAll('#filmSegs .fseg'); fs.forEach(function (x) { x.classList.add('done'); x.querySelector('i').style.width = '100%'; });
    } else {
      setScene(0);
    }
  }

  /* ----- analytics strip bars ----- */
  (function () {
    var bars = document.getElementById('anaBars');
    var data = [62,48,71,55,90,84,40,66,78,95,72,58,88,100];
    data.forEach(function (v, i) {
      var day = document.createElement('div');
      day.className = 'day';
      var c = Math.round(v * (0.25 + 0.18 * Math.sin(i * 1.7)));
      day.innerHTML = '<i class="s" style="height:' + v + '%"></i><i class="c" style="height:' + Math.max(c, 6) + '%"></i>';
      bars.appendChild(day);
    });
  })();

  /* ----- tweak hooks ----- */
  window.__adeyyApplyTweaks = function (t) {
    document.documentElement.dataset.adeyyHue = t.hue === 'links' ? '' : t.hue;
    if (t.hue === 'links') delete document.documentElement.dataset.adeyyHue;
    document.documentElement.dataset.hero = t.heroSurface;
    qrStyle.modules = t.qrStyle === 'dots' ? 'dots' : t.qrStyle;
    qrStyle.eyes = t.qrStyle === 'square' ? 'square' : 'rounded';
    var heads = {
      anywhere: ['Link <em>anywhere</em>.', 'One short link. One QR code. Change where they point at any time, even after you print.'],
      print: ['The QR code you can change after you <em>print</em>.', 'Every Adeyy code is a short link you control. Edit the destination once, it changes everywhere the code lives.'],
      once: ['Edit once. Change <em>everywhere</em>.', 'A flyer, a sticker, a sign. One edit in the dashboard and every printed code points somewhere new.']
    };
    var h = heads[t.headline] || heads.anywhere;
    document.getElementById('heroHeadline').innerHTML = h[0];
    document.getElementById('heroSub').textContent = h[1];
    renderDeco();
    repaintAllQR();
  };

  initFilm();
})();
