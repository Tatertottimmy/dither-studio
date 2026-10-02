// Minimal animated GIF decoder + encoder, no dependencies (works in every browser,
// unlike the Chromium-only ImageDecoder API).
(function () {
  "use strict";

  // ---------------- Decoder ----------------

  // Standard GIF LZW decode (prefix/suffix table + output stack).
  function lzwDecode(minCode, data, n) {
    var out = new Uint8Array(n), clear = 1 << minCode, eoi = clear + 1;
    var prefix = new Int16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
    var size = minCode + 1, mask = (1 << size) - 1, avail = eoi + 1, old = -1, firstChar = 0;
    for (var i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; }
    var acc = 0, bits = 0, pos = 0, op = 0;
    while (op < n) {
      while (bits < size) { if (pos >= data.length) return out; acc |= data[pos++] << bits; bits += 8; }
      var code = acc & mask; acc >>>= size; bits -= size;
      if (code === clear) { size = minCode + 1; mask = (1 << size) - 1; avail = eoi + 1; old = -1; continue; }
      if (code === eoi) break;
      if (old === -1) { out[op++] = suffix[code]; old = code; firstChar = code; continue; }
      var inCode = code, sp = 0;
      if (code >= avail) { stack[sp++] = firstChar; code = old; }   // the KwKwK case
      while (code >= clear) { stack[sp++] = suffix[code]; code = prefix[code]; }
      firstChar = suffix[code]; stack[sp++] = firstChar;
      while (sp > 0 && op < n) out[op++] = stack[--sp];
      if (avail < 4096) {
        prefix[avail] = old; suffix[avail] = firstChar; avail++;
        if ((avail & mask) === 0 && avail < 4096) { size++; mask = (1 << size) - 1; }
      }
      old = inCode;
    }
    return out;
  }

  // Returns { width, height, frames: [{ canvas, delay(ms) }] } with every frame fully composed.
  function decode(buffer, limits) {
    limits = limits || {};
    var maxFrames = limits.maxFrames || 300, maxPixels = limits.maxPixels || 80e6;
    var b = new Uint8Array(buffer), p = 0;
    var sig = String.fromCharCode.apply(null, b.subarray(0, 6));
    if (sig !== "GIF87a" && sig !== "GIF89a") throw new Error("Not a GIF");
    p = 6;
    var W = b[p] | (b[p + 1] << 8), H = b[p + 2] | (b[p + 3] << 8), packed = b[p + 4]; p += 7;
    var gct = null;
    if (packed & 0x80) { var n = 2 << (packed & 7); gct = b.subarray(p, p + n * 3); p += n * 3; }

    var comp = new Uint8ClampedArray(W * H * 4), saved = null, frames = [], truncated = false;
    var gce = { delay: 0, trans: -1, disposal: 0 }, prevRect = null, prevDisposal = 0;

    function subBlocks() {
      var parts = [], total = 0;
      while (p < b.length) { var sz = b[p++]; if (!sz) break; parts.push(b.subarray(p, p + sz)); total += sz; p += sz; }
      var out = new Uint8Array(total), o = 0;
      parts.forEach(function (x) { out.set(x, o); o += x.length; });
      return out;
    }

    while (p < b.length) {
      var t = b[p++];
      if (t === 0x3B) break;                                   // trailer
      if (t === 0x21) {                                        // extension
        var label = b[p++];
        if (label === 0xF9) {
          var bp = b[p + 1];
          gce = { disposal: (bp >> 2) & 7, trans: (bp & 1) ? b[p + 4] : -1, delay: (b[p + 2] | (b[p + 3] << 8)) * 10 };
          p += 1 + b[p]; subBlocks();
        } else subBlocks();
        continue;
      }
      if (t !== 0x2C) break;                                   // unknown block: stop

      var fx = b[p] | (b[p + 1] << 8), fy = b[p + 2] | (b[p + 3] << 8);
      var fw = b[p + 4] | (b[p + 5] << 8), fh = b[p + 6] | (b[p + 7] << 8), fp = b[p + 8]; p += 9;
      var pal = gct;
      if (fp & 0x80) { var ln = 2 << (fp & 7); pal = b.subarray(p, p + ln * 3); p += ln * 3; }
      var minCode = b[p++], px = lzwDecode(minCode, subBlocks(), fw * fh);
      if (fp & 0x40) {                                         // de-interlace
        var de = new Uint8Array(fw * fh), row = 0;
        [[0, 8], [4, 8], [2, 4], [1, 2]].forEach(function (pass) {
          for (var y = pass[0]; y < fh; y += pass[1]) { de.set(px.subarray(row * fw, row * fw + fw), y * fw); row++; }
        });
        px = de;
      }

      // dispose the previous frame, then save state if this frame asks to be restored later
      if (prevDisposal === 2 && prevRect) {
        for (var yy = prevRect.y; yy < prevRect.y + prevRect.h && yy < H; yy++)
          comp.fill(0, (yy * W + prevRect.x) * 4, (yy * W + Math.min(W, prevRect.x + prevRect.w)) * 4);
      } else if (prevDisposal === 3 && saved) comp.set(saved);
      saved = gce.disposal === 3 ? comp.slice() : null;

      if (pal) {
        for (var y2 = 0; y2 < fh; y2++) {
          var cy = fy + y2; if (cy >= H) break;
          for (var x2 = 0; x2 < fw; x2++) {
            var cx = fx + x2; if (cx >= W) break;
            var ci = px[y2 * fw + x2]; if (ci === gce.trans) continue;
            var o = (cy * W + cx) * 4;
            comp[o] = pal[ci * 3]; comp[o + 1] = pal[ci * 3 + 1]; comp[o + 2] = pal[ci * 3 + 2]; comp[o + 3] = 255;
          }
        }
      }
      var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      cv.getContext("2d").putImageData(new ImageData(comp.slice(), W, H), 0, 0);
      frames.push({ canvas: cv, delay: gce.delay >= 20 ? gce.delay : 100 });   // browsers treat 0-10ms as 100ms

      prevRect = { x: fx, y: fy, w: fw, h: fh }; prevDisposal = gce.disposal;
      gce = { delay: 0, trans: -1, disposal: 0 };
      if (frames.length >= maxFrames || frames.length * W * H > maxPixels) { truncated = true; break; }
    }
    return { width: W, height: H, frames: frames, truncated: truncated };
  }

  // ---------------- Encoder ----------------

  function lzwEncode(minCode, idx, out) {
    var clear = 1 << minCode, eoi = clear + 1, size = minCode + 1, next = eoi + 1;
    var dict = new Map(), acc = 0, bits = 0, block = [];
    function emit(code) {
      acc |= code << bits; bits += size;
      while (bits >= 8) { block.push(acc & 255); acc >>>= 8; bits -= 8; if (block.length === 255) flush(); }
    }
    function flush() { if (block.length) { out.push(block.length); for (var i = 0; i < block.length; i++) out.push(block[i]); block = []; } }
    emit(clear);
    var w = idx[0];
    for (var i = 1; i < idx.length; i++) {
      var k = idx[i], key = w * 256 + k, hit = dict.get(key);
      if (hit !== undefined) { w = hit; continue; }
      emit(w);
      if (next < 4096) {
        dict.set(key, next++);
        if (next > (1 << size) && size < 12) size++;
      } else { emit(clear); dict.clear(); size = minCode + 1; next = eoi + 1; }
      w = k;
    }
    emit(w); emit(eoi);
    if (bits > 0) { block.push(acc & 255); if (block.length === 255) flush(); }
    flush(); out.push(0);
  }

  // frames: [{ idx: Uint8Array (w*h palette indices), delay: ms }], palette: ["#rrggbb", ...] (<= 256)
  function encode(frames, w, h, palette) {
    var n = 1; while ((1 << n) < Math.max(2, palette.length)) n++;
    var out = [], push = function () { for (var i = 0; i < arguments.length; i++) out.push(arguments[i]); };
    "GIF89a".split("").forEach(function (c) { out.push(c.charCodeAt(0)); });
    push(w & 255, w >> 8, h & 255, h >> 8, 0x80 | ((n - 1) << 4) | (n - 1), 0, 0);
    for (var i = 0; i < (1 << n); i++) {
      var v = parseInt((palette[i] || "#000000").slice(1), 16);
      push((v >> 16) & 255, (v >> 8) & 255, v & 255);
    }
    push(0x21, 0xFF, 11); "NETSCAPE2.0".split("").forEach(function (c) { out.push(c.charCodeAt(0)); });
    push(3, 1, 0, 0, 0);                                      // loop forever
    frames.forEach(function (f) {
      var cs = Math.max(2, Math.round(f.delay / 10));
      push(0x21, 0xF9, 4, 0x04, cs & 255, cs >> 8, 0, 0);       // disposal 1: keep, no transparency
      push(0x2C, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0);
      var minCode = Math.max(2, n);
      out.push(minCode); lzwEncode(minCode, f.idx, out);
    });
    out.push(0x3B);
    return new Uint8Array(out);
  }

  window.Gif = { decode: decode, encode: encode };
})();
