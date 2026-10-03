// Dither: image -> two-colour dithered bitmap -> SVG/PNG. No dependencies.
(function () {
  "use strict";

  function bayer(n) {                       // n = 2, 4 or 8
    var m = [[0]];
    for (var s = 1; s < n; s *= 2) {
      var r = [];
      for (var y = 0; y < s * 2; y++) {
        r.push([]);
        for (var x = 0; x < s * 2; x++) {
          r[y].push(4 * m[y % s][x % s] + [0, 2, 3, 1][(y < s ? 0 : 2) + (x < s ? 0 : 1)]);
        }
      }
      m = r;
    }
    return m;
  }
  var BAYER = { 2: bayer(2), 4: bayer(4), 8: bayer(8) };

  // Downscale the source to `cols` dots across (stepwise halving keeps it sharp-but-smooth).
  // `rows` is optional (ASCII mode passes it, since character cells aren't square).
  // Returns luminance L plus each cell's colour (rgb, 3 bytes per cell) for tinting.
  function sample(img, cols, rowsWanted) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    cols = Math.max(8, Math.min(cols, iw));
    var rows = Math.max(1, Math.min(ih, rowsWanted || Math.round(cols * ih / iw)));
    var src = img, w = iw, h = ih;
    while (w / 2 > cols) {
      var c = document.createElement("canvas");
      w = Math.round(w / 2); h = Math.round(h / 2);
      c.width = w; c.height = h;
      var cx = c.getContext("2d"); cx.imageSmoothingQuality = "high";
      cx.drawImage(src, 0, 0, w, h); src = c;
    }
    var out = document.createElement("canvas"); out.width = cols; out.height = rows;
    var ox = out.getContext("2d", { willReadFrequently: true });
    ox.imageSmoothingQuality = "high"; ox.drawImage(src, 0, 0, cols, rows);
    var d = ox.getImageData(0, 0, cols, rows).data, L = new Float32Array(cols * rows), rgb = new Uint8ClampedArray(cols * rows * 3);
    var A = new Float32Array(cols * rows), Lraw = new Float32Array(cols * rows), hasAlpha = false;
    for (var i = 0; i < L.length; i++) {
      var a = d[i * 4 + 3] / 255;                     // transparent pixels read as paper for tone...
      A[i] = a; if (a < 0.98) hasAlpha = true;        // ...and are tracked separately for transparency
      // true colour of edge pixels (not lightened); fully clear pixels read as white so they add no error
      Lraw[i] = a > 0.02 ? (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255 : 1;
      L[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255 * a + (1 - a);
      rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2];
    }
    return { w: cols, h: rows, L: L, Lraw: Lraw, rgb: rgb, A: A, hasAlpha: hasAlpha };
  }

  // Tone adjustments, in this order: brightness, contrast, gamma, sharpen.
  function adjust(s, o) {
    var w = s.w, h = s.h, src = s.L, L = new Float32Array(src.length);
    var c = o.contrast >= 0 ? 1 + o.contrast / 50 : 1 + o.contrast / 100;   // -100..100
    for (var i = 0; i < L.length; i++) {
      var v = src[i] + o.brightness / 100;
      v = (v - 0.5) * c + 0.5;
      v = Math.min(1, Math.max(0, v));
      L[i] = Math.pow(v, 1 / o.gamma);
    }
    if (o.local > 0) {                                      // local contrast: push each tone away from its surroundings
      var B = blur(L, w, h, Math.max(2, Math.round(Math.max(w, h) / 20)));
      for (var j = 0; j < L.length; j++) L[j] = Math.min(1, Math.max(0, L[j] + o.local * (L[j] - B[j])));
    }
    if (o.sharpen > 0) {
      var out = new Float32Array(L.length);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var sum = 0, n = 0;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var yy = y + dy, xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w) { sum += L[yy * w + xx]; n++; }
        }
        var p = y * w + x;
        out[p] = L[p] + o.sharpen * (L[p] - sum / n);
      }
      L = out;
    }
    return L;
  }

  // Box blur, run twice (close to a Gaussian), radius r, separable running sums.
  function blur(src, w, h, r) {
    var a = Float32Array.from(src), t = new Float32Array(a.length);
    for (var pass = 0; pass < 2; pass++) {
      for (var y = 0; y < h; y++) {                         // horizontal
        var sum = 0, row = y * w;
        for (var x = -r; x <= r; x++) sum += a[row + Math.min(w - 1, Math.max(0, x))];
        for (var x2 = 0; x2 < w; x2++) {
          t[row + x2] = sum / (2 * r + 1);
          sum += a[row + Math.min(w - 1, x2 + r + 1)] - a[row + Math.max(0, x2 - r)];
        }
      }
      for (var x3 = 0; x3 < w; x3++) {                      // vertical
        var sum2 = 0;
        for (var y2 = -r; y2 <= r; y2++) sum2 += t[Math.min(h - 1, Math.max(0, y2)) * w + x3];
        for (var y3 = 0; y3 < h; y3++) {
          a[y3 * w + x3] = sum2 / (2 * r + 1);
          sum2 += t[Math.min(h - 1, y3 + r + 1) * w + x3] - t[Math.max(0, y3 - r) * w + x3];
        }
      }
    }
    return a;
  }

  // Tone percentiles of a sample (see-through pixels ignored), for auto-adjust.
  function toneStats(smp) {
    var hist = new Uint32Array(256), n = 0;
    for (var i = 0; i < smp.L.length; i++) {
      if (smp.A && smp.A[i] < 0.5) continue;
      hist[Math.min(255, Math.max(0, Math.round(smp.L[i] * 255)))]++; n++;
    }
    function pct(q) { var t = q * n, c = 0; for (var k = 0; k < 256; k++) { c += hist[k]; if (c >= t) return k / 255; } return 1; }
    return n ? { lo: pct(0.02), mid: pct(0.5), hi: pct(0.98) } : null;
  }

  // Dither luminance to `levels` evenly spaced tones (2-4).
  // Returns Uint8Array of palette indices: 0 = darkest colour ... levels-1 = lightest.
  function dither(L, w, h, algo, levels) {
    var n = (levels || 2) - 1, idx = new Uint8Array(w * h);
    if (algo === "threshold") {
      for (var i = 0; i < idx.length; i++) idx[i] = Math.round(Math.min(1, Math.max(0, L[i])) * n);
      return idx;
    }
    if (algo.indexOf("bayer") === 0) {
      var size = +algo.slice(5), m = BAYER[size], nn = size * size;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var p = y * w + x, v = Math.min(1, Math.max(0, L[p])) * n, k = Math.floor(v);
        if (k >= n) { idx[p] = n; continue; }
        idx[p] = v - k > (m[y % size][x % size] + 0.5) / nn ? k + 1 : k;
      }
      return idx;
    }
    // Error diffusion (serpentine scan): quantise to the nearest tone, spread the error.
    var K = algo === "atkinson"
      ? { div: 8, k: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] }
      : { div: 16, k: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] };      // Floyd-Steinberg
    var e = Float32Array.from(L);
    for (var y2 = 0; y2 < h; y2++) {
      var rev = y2 & 1;
      for (var i2 = 0; i2 < w; i2++) {
        var x2 = rev ? w - 1 - i2 : i2, q = y2 * w + x2, old = e[q];
        var lvl = Math.round(Math.min(1, Math.max(0, old)) * n);
        idx[q] = lvl;
        var err = (old - lvl / n) / K.div;
        for (var j = 0; j < K.k.length; j++) {
          var tx = x2 + (rev ? -K.k[j][0] : K.k[j][0]), ty = y2 + K.k[j][1];
          if (tx >= 0 && tx < w && ty < h) e[ty * w + tx] += err * K.k[j][2];
        }
      }
    }
    return idx;
  }

  // Transparency. Palette index 255 means "see-through" everywhere in the pipeline.
  var CLEAR = 255;
  // Opacity mask from per-cell alpha: "hard" cuts at 50%, "dither" dissolves soft edges with Bayer 4x4.
  function alphaMask(A, w, h, edge) {
    var m = new Uint8Array(w * h), b = BAYER[4];
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var a = A[y * w + x];
      m[y * w + x] = edge === "hard" ? (a >= 0.5 ? 1 : 0) : (a > (b[y & 3][x & 3] + 0.5) / 16 ? 1 : 0);
    }
    return m;
  }
  function applyMask(idx, mask) {
    var out = Uint8Array.from(idx);
    for (var i = 0; i < out.length; i++) if (!mask[i]) out[i] = CLEAR;
    return out;
  }

  function hexToRgb(hex) {
    var v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  // palette: array of hex colours, darkest tone first.
  function paint(canvas, idx, w, h, palette) {
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext("2d"), img = ctx.createImageData(w, h), d = img.data;
    var pal = palette.map(hexToRgb);
    for (var i = 0; i < idx.length; i++) {
      var o = i * 4;
      if (idx[i] === CLEAR) { d[o + 3] = 0; continue; }
      var c = pal[idx[i]];
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  // Vector export: background rect in the most common colour, then one path per other
  // colour made of merged horizontal runs. Crisp at any size, reasonably small.
  function toSVG(idx, w, h, palette) {
    var counts = palette.map(function () { return 0; }), clear = 0;
    for (var i = 0; i < idx.length; i++) { if (idx[i] === CLEAR) clear++; else counts[idx[i]]++; }
    // With transparency there's no background rect: every colour is drawn and gaps stay see-through.
    var bg = clear ? -1 : counts.indexOf(Math.max.apply(null, counts));
    var paths = palette.map(function () { return []; });
    for (var y = 0; y < h; y++) {
      var x = 0;
      while (x < w) {
        var c = idx[y * w + x], s0 = x;
        while (x < w && idx[y * w + x] === c) x++;
        if (c !== bg && c !== CLEAR) paths[c].push("M" + s0 + " " + y + "h" + (x - s0) + "v1h-" + (x - s0) + "z");
      }
    }
    var body = bg < 0 ? "" : '<rect width="' + w + '" height="' + h + '" fill="' + palette[bg] + '"/>';
    palette.forEach(function (col, k) {
      if (k !== bg && paths[k].length) body += '<path fill="' + col + '" d="' + paths[k].join("") + '"/>';
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + " " + h + '" width="' + w + '" height="' + h +
      '" shape-rendering="crispEdges">' + body + "</svg>";
  }

  // Dithered fade: dissolve the image into one palette colour across a band, using the
  // 8x8 Bayer matrix so the transition is made of the same single pixels as the art.
  //   f = { edge: "bottom" | "top", a: 0..1, b: 0..1 (a < b, as fractions of height), color: palette index }
  // bottom: image above a, dissolving between a and b, solid colour below b. top: the mirror.
  function fade(idx, w, h, f) {
    var out = Uint8Array.from(idx), m = BAYER[8];
    var a = Math.min(f.a, f.b) * h, b = Math.max(f.a, f.b) * h, span = Math.max(1, b - a);
    for (var y = 0; y < h; y++) {
      var t = (y + 0.5 - a) / span;                 // 0 at line a, 1 at line b
      if (f.edge === "top") t = 1 - t;
      if (t <= 0) continue;
      var row = m[y & 7];
      for (var x = 0; x < w; x++) {
        if (out[y * w + x] !== CLEAR && (t >= 1 || t > (row[x & 7] + 0.5) / 64)) out[y * w + x] = f.color;
      }
    }
    return out;
  }

  // Is this image already a dithered piece (a few flat colours)? Read it pixel-for-pixel at its
  // own size; if up to 32 colours cover ~all of it, return those pixels as palette indices.
  function readPredithered(img) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h || w * h > 4000 * 4000) return null;
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var cx = c.getContext("2d", { willReadFrequently: true });
    cx.imageSmoothingEnabled = false; cx.drawImage(img, 0, 0, w, h);
    var d = cx.getImageData(0, 0, w, h).data, counts = new Map(), clearPx = 0;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) { clearPx++; continue; }
      var k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      counts.set(k, (counts.get(k) || 0) + 1);
      if (counts.size > 64) return null;                  // a photo, not flat dithered art
    }
    var top = Array.from(counts.entries()).sort(function (p, q) { return q[1] - p[1]; }).slice(0, 32);
    var covered = top.reduce(function (s, e) { return s + e[1]; }, 0);
    if (top.length < (clearPx ? 1 : 2) || covered < 0.995 * (w * h - clearPx)) return null;
    var lum = function (k) { return 0.2126 * (k >> 16) + 0.7152 * ((k >> 8) & 255) + 0.0722 * (k & 255); };
    var keys = top.map(function (e) { return e[0]; }).sort(function (p, q) { return lum(p) - lum(q); });   // darkest first
    var rgbs = keys.map(function (k) { return [k >> 16, (k >> 8) & 255, k & 255]; });
    var idx = new Uint8Array(w * h);
    for (var j = 0, p = 0; j < d.length; j += 4, p++) {
      if (d[j + 3] < 128) { idx[p] = CLEAR; continue; }
      var best = 0, bd = 1e9;                              // stray pixels snap to the nearest colour
      for (var q = 0; q < rgbs.length; q++) {
        var dr = d[j] - rgbs[q][0], dg = d[j + 1] - rgbs[q][1], db = d[j + 2] - rgbs[q][2], dd = dr * dr + dg * dg + db * db;
        if (dd < bd) { bd = dd; best = q; }
      }
      idx[p] = best;
    }
    return { w: w, h: h, idx: idx, hasAlpha: clearPx > 0, palette: keys.map(function (k) { return "#" + k.toString(16).padStart(6, "0"); }) };
  }

  // ================= Colour mapping =================

  // Brightness bands with custom boundaries. stops[i] (0..1) is where colour i+1 takes over from
  // colour i. Remaps L so each boundary lands on the dither's natural midpoint between levels,
  // which means equal stops ((i+0.5)/(n-1)) leave the image unchanged.
  function defaultStops(n) { var s = []; for (var i = 1; i < n; i++) s.push((i - 0.5) / (n - 1)); return s; }
  function toneRemap(L, stops, n) {
    if (!stops || stops.length !== n - 1) return L;
    var xs = [0].concat(stops, [1]), ys = [0];
    for (var i = 1; i < n; i++) ys.push((i - 0.5) / (n - 1));
    ys.push(1);
    var out = new Float32Array(L.length);
    for (var p = 0; p < L.length; p++) {
      var v = Math.min(1, Math.max(0, L[p])), k = 1;
      while (k < xs.length - 1 && v > xs[k]) k++;
      var x0 = xs[k - 1], x1 = xs[k], t = x1 > x0 ? (v - x0) / (x1 - x0) : 0;
      out[p] = ys[k - 1] + (ys[k] - ys[k - 1]) * t;
    }
    return out;
  }

  // Same tone controls as adjust(), applied to R, G and B (0..1 floats, 3 per cell).
  function adjustRGB(smp, o) {
    var n = smp.w * smp.h, F = new Float32Array(n * 3);
    var c = o.contrast >= 0 ? 1 + o.contrast / 50 : 1 + o.contrast / 100;
    for (var i = 0; i < n * 3; i++) {
      var v = smp.rgb[i] / 255 + o.brightness / 100;
      v = Math.min(1, Math.max(0, (v - 0.5) * c + 0.5));
      F[i] = Math.pow(v, 1 / o.gamma);
    }
    if (o.local > 0) {                                      // local contrast, per channel
      var r = Math.max(2, Math.round(Math.max(smp.w, smp.h) / 20)), C = new Float32Array(n);
      for (var chl = 0; chl < 3; chl++) {
        for (var k = 0; k < n; k++) C[k] = F[k * 3 + chl];
        var Bc = blur(C, smp.w, smp.h, r);
        for (var k2 = 0; k2 < n; k2++) F[k2 * 3 + chl] = Math.min(1, Math.max(0, C[k2] + o.local * (C[k2] - Bc[k2])));
      }
    }
    if (o.sharpen > 0) {
      var w = smp.w, h = smp.h, G = new Float32Array(F.length);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) for (var ch = 0; ch < 3; ch++) {
        var sum = 0, m = 0;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var yy = y + dy, xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w) { sum += F[(yy * w + xx) * 3 + ch]; m++; }
        }
        var q = (y * w + x) * 3 + ch;
        G[q] = Math.min(1, Math.max(0, F[q] + o.sharpen * (F[q] - sum / m)));
      }
      F = G;
    }
    return F;
  }

  function rgbList(palette) { return palette.map(function (h) { var v = parseInt(h.slice(1), 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; }); }
  // Weighted RGB distance (eyes are most sensitive to green, least to blue).
  function nearest(P, r, g, b) {
    var best = 0, bd = 1e9;
    for (var i = 0; i < P.length; i++) {
      var dr = r - P[i][0], dg = g - P[i][1], db = b - P[i][2], d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // Nearest-colour dithering: each cell gets the palette colour closest to its real colour.
  function ditherMatch(F, w, h, palette, algo) {
    var P = rgbList(palette), idx = new Uint8Array(w * h);
    if (algo === "threshold" || algo.indexOf("bayer") === 0) {
      var size = algo === "threshold" ? 0 : +algo.slice(5), m = size ? BAYER[size] : null, spread = 0.45;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var p = y * w + x, o = m ? ((m[y % size][x % size] + 0.5) / (size * size) - 0.5) * spread : 0;
        idx[p] = nearest(P, F[p * 3] + o, F[p * 3 + 1] + o, F[p * 3 + 2] + o);
      }
      return idx;
    }
    var K = algo === "atkinson"
      ? { div: 8, k: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] }
      : { div: 16, k: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] };
    var e = Float32Array.from(F);
    for (var y2 = 0; y2 < h; y2++) {
      var rev = y2 & 1;
      for (var i2 = 0; i2 < w; i2++) {
        var x2 = rev ? w - 1 - i2 : i2, q = (y2 * w + x2) * 3;
        var r = e[q], g = e[q + 1], b = e[q + 2], k = nearest(P, r, g, b);
        idx[y2 * w + x2] = k;
        var er = (r - P[k][0]) / K.div, eg = (g - P[k][1]) / K.div, eb = (b - P[k][2]) / K.div;
        for (var j = 0; j < K.k.length; j++) {
          var tx = x2 + (rev ? -K.k[j][0] : K.k[j][0]), ty = y2 + K.k[j][1];
          if (tx >= 0 && tx < w && ty < h) { var t = (ty * w + tx) * 3, wgt = K.k[j][2]; e[t] += er * wgt; e[t + 1] += eg * wgt; e[t + 2] += eb * wgt; }
        }
      }
    }
    return idx;
  }

  // Hue mapping value: saturated cells by hue (rotated by `shift` degrees), grey cells by brightness,
  // blended by saturation so neutral areas don't turn to noise. Feed the result to dither().
  function hueValue(F, n, shift) {
    var V = new Float32Array(n), off = (shift || 0) / 360;
    for (var i = 0; i < n; i++) {
      var r = F[i * 3], g = F[i * 3 + 1], b = F[i * 3 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, hh = 0;
      if (d > 1e-6) hh = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      var hue = ((hh / 6 + off) % 1 + 1) % 1, sat = mx > 0 ? d / mx : 0, lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      var wgt = Math.min(1, sat * 1.6);
      V[i] = hue * wgt + lum * (1 - wgt);
    }
    return V;
  }

  // Pick n representative colours from a sample (k-means++ on up to ~12k pixels), darkest first.
  function pickColors(smp, n) {
    var total = smp.w * smp.h, step = Math.max(1, Math.floor(total / 12000)), pts = [];
    for (var i = 0; i < total; i += step) {
      if (smp.A && smp.A[i] < 0.5) continue;                  // ignore see-through pixels
      pts.push([smp.rgb[i * 3], smp.rgb[i * 3 + 1], smp.rgb[i * 3 + 2]]);
    }
    if (!pts.length) return null;
    var d2 = function (a, b) { var x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return x * x + y * y + z * z; };
    var seed = 12345, rnd = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    var C = [pts[Math.floor(rnd() * pts.length)].slice()];
    while (C.length < n) {                                     // k-means++ seeding: spread the starts out
      var D = pts.map(function (p) { return Math.min.apply(null, C.map(function (c) { return d2(p, c); })); });
      var sum = D.reduce(function (a, b) { return a + b; }, 0), r = rnd() * sum, j = 0;
      while (j < D.length - 1 && (r -= D[j]) > 0) j++;
      C.push(pts[j].slice());
    }
    for (var it = 0; it < 12; it++) {
      var acc = C.map(function () { return [0, 0, 0, 0]; });
      pts.forEach(function (p) {
        var bi = 0, bd = 1e12;
        for (var c = 0; c < C.length; c++) { var dd = d2(p, C[c]); if (dd < bd) { bd = dd; bi = c; } }
        acc[bi][0] += p[0]; acc[bi][1] += p[1]; acc[bi][2] += p[2]; acc[bi][3]++;
      });
      C = C.map(function (c, k) { return acc[k][3] ? [acc[k][0] / acc[k][3], acc[k][1] / acc[k][3], acc[k][2] / acc[k][3]] : c; });
    }
    var hex = C.map(function (c) { return "#" + c.map(function (v) { return Math.round(v).toString(16).padStart(2, "0"); }).join(""); });
    var lum = function (h) { var v = parseInt(h.slice(1), 16); return 0.2126 * (v >> 16) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255); };
    return hex.sort(function (a, b) { return lum(a) - lum(b); });
  }

  window.DitherCore = { blur: blur, toneStats: toneStats, sample: sample, adjust: adjust, dither: dither, paint: paint, toSVG: toSVG, fade: fade, readPredithered: readPredithered,
                         CLEAR: CLEAR, alphaMask: alphaMask, applyMask: applyMask,
                         defaultStops: defaultStops, toneRemap: toneRemap, adjustRGB: adjustRGB, ditherMatch: ditherMatch,
                         hueValue: hueValue, pickColors: pickColors };
})();
