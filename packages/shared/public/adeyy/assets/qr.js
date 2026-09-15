/* Adeyy QR renderer.
   Wraps qrcode-generator (loaded globally as `qrcode`) and renders
   styled, scannable SVG QR codes inside the design system rules:
   quiet zone always preserved, safe module/eye presets only,
   error correction H whenever a logo covers the centre. */

(function () {
  'use strict';

  function makeQR(text, ecc) {
    var qr = qrcode(0, ecc || 'Q');
    qr.addData(text);
    qr.make();
    return qr;
  }

  function inFinder(r, c, n) {
    return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  }

  function lum(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (x) { return x + x; }).join('');
    var rgb = [0, 2, 4].map(function (i) {
      var v = parseInt(h.substr(i, 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }

  function contrast(fg, bg) {
    var a = lum(fg), b = lum(bg);
    var hi = Math.max(a, b), lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }

  /* One eye (finder pattern), top-left corner at (x, y), in module units. */
  function eyeSvg(x, y, style, fg) {
    var d, inner;
    if (style === 'rounded') {
      d = '<path fill="' + fg + '" fill-rule="evenodd" d="' +
        'M' + (x + 2) + ' ' + y + 'h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2z' +
        'M' + (x + 2.1) + ' ' + (y + 1) + 'a1.1 1.1 0 0 0-1.1 1.1v2.8a1.1 1.1 0 0 0 1.1 1.1h2.8a1.1 1.1 0 0 0 1.1-1.1v-2.8a1.1 1.1 0 0 0-1.1-1.1z"/>';
      inner = '<rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="3" height="3" rx="1.1" fill="' + fg + '"/>';
    } else {
      d = '<path fill="' + fg + '" fill-rule="evenodd" d="' +
        'M' + x + ' ' + y + 'h7v7h-7z' +
        'M' + (x + 1) + ' ' + (y + 1) + 'v5h5v-5z"/>';
      inner = '<rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="3" height="3" fill="' + fg + '"/>';
    }
    return d + inner;
  }

  /* Render a styled SVG string.
     opts: { fg, bg, modules: 'square'|'rounded'|'dots', eyes: 'square'|'rounded',
             logo: null | svg-string-or-dataURL, ecc, quiet, source } */
  function svgString(text, opts) {
    opts = opts || {};
    var fg = opts.fg || '#0E0E0C';
    var bg = opts.bg || '#FBFAF4';
    var modules = opts.modules || 'square';
    var eyes = opts.eyes || 'square';
    var quiet = opts.quiet == null ? 4 : opts.quiet;
    var ecc = opts.logo ? 'H' : (opts.ecc || 'Q');
    var qr = makeQR(text, ecc);
    var n = qr.getModuleCount();
    var total = n + quiet * 2;

    /* Logo clear zone: a centred square ~ 24% of the code width */
    var logoCells = 0, lo = 0, hi = 0;
    if (opts.logo) {
      logoCells = Math.floor(n * 0.24);
      if (logoCells % 2 !== n % 2) logoCells += 1; /* centre alignment */
      lo = (n - logoCells) / 2;
      hi = lo + logoCells;
    }

    var parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="' + (modules === 'square' ? 'crispEdges' : 'geometricPrecision') + '">');
    parts.push('<rect width="' + total + '" height="' + total + '" fill="' + bg + '"/>');
    parts.push('<g transform="translate(' + quiet + ' ' + quiet + ')">');

    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        if (inFinder(r, c, n)) continue;
        if (opts.logo && r >= lo && r < hi && c >= lo && c < hi) continue;
        if (modules === 'dots') {
          parts.push('<circle cx="' + (c + 0.5) + '" cy="' + (r + 0.5) + '" r="0.42" fill="' + fg + '"/>');
        } else if (modules === 'rounded') {
          parts.push('<rect x="' + (c + 0.04) + '" y="' + (r + 0.04) + '" width="0.92" height="0.92" rx="0.3" fill="' + fg + '"/>');
        } else {
          parts.push('<rect x="' + c + '" y="' + r + '" width="1" height="1" fill="' + fg + '"/>');
        }
      }
    }

    parts.push(eyeSvg(0, 0, eyes, fg));
    parts.push(eyeSvg(n - 7, 0, eyes, fg));
    parts.push(eyeSvg(0, n - 7, eyes, fg));

    if (opts.logo) {
      var pad = 0.5;
      parts.push('<rect x="' + (lo - pad) + '" y="' + (lo - pad) + '" width="' + (logoCells + pad * 2) + '" height="' + (logoCells + pad * 2) + '" rx="' + (logoCells * 0.12) + '" fill="' + bg + '"/>');
      if (opts.logo.indexOf('<svg') === 0) {
        /* inline svg, scaled into the clear zone */
        var inner = opts.logo
          .replace(/^<svg[^>]*>/, '')
          .replace(/<\/svg>\s*$/, '');
        var vb = (opts.logoViewBox || '0 0 24 24').split(/\s+/).map(Number);
        var s = (logoCells * 0.78) / Math.max(vb[2], vb[3]);
        var ox = lo + (logoCells - vb[2] * s) / 2 - vb[0] * s;
        var oy = lo + (logoCells - vb[3] * s) / 2 - vb[1] * s;
        parts.push('<g transform="translate(' + ox + ' ' + oy + ') scale(' + s + ')">' + inner + '</g>');
      } else {
        var sz = logoCells * 0.78, off = lo + logoCells * 0.11;
        parts.push('<image href="' + opts.logo + '" x="' + off + '" y="' + off + '" width="' + sz + '" height="' + sz + '" preserveAspectRatio="xMidYMid meet"/>');
      }
    }

    parts.push('</g></svg>');
    return parts.join('');
  }

  function toPngDataUrl(svgStr, px) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml' }));
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = px; canvas.height = px;
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, px, px);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = function (e) { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  function download(filename, data, mime) {
    var a = document.createElement('a');
    if (data.indexOf('data:') === 0) {
      a.href = data;
    } else {
      a.href = URL.createObjectURL(new Blob([data], { type: mime || 'image/svg+xml' }));
    }
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  window.AdeyyQR = {
    svgString: svgString,
    contrast: contrast,
    toPngDataUrl: toPngDataUrl,
    download: download
  };
})();
