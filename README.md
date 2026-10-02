# Dither Studio

Turn a photo or an animated GIF into a dithered image in 2 to 4 colours, or into ASCII art, right in the browser. Export as a crisp vector SVG, a pixel-perfect PNG, an animated GIF, or plain text.

**Try it:** https://mikemadeit.io/dither/

Everything runs locally in your browser. Photos are never uploaded anywhere.

## Features

- **Load a photo or an animated GIF** by dragging it onto the page, pasting it, or choosing a file.
- **Animated GIFs** play in the preview while you adjust anything, with a play/pause button and frame counter, and export as an animated GIF in either mode (original frame timing, scale 1x to 8x). Frames are decoded and encoded by the app itself, so this works in every browser, including Firefox.
- **Dither patterns:** Floyd-Steinberg, Atkinson, Bayer 2x2 / 4x4 / 8x8 (ordered), or plain threshold.
- **Tone controls:** pixel density (dots across), brightness, contrast, gamma and sharpen, with a live preview. Scroll over any slider to nudge it (Shift for bigger steps).
- **2 to 4 colours,** ordered darkest to lightest. Each colour takes an equal band of the image's tones, with dithered blends in between.
- **Apply colours by:**
  - **Brightness:** each colour takes a band of tones, shown as a bar with draggable handles so you decide where each colour starts.
  - **Nearest colour:** each pixel gets whichever of your colours is closest to its real colour, dithered in between (the classic limited-palette look).
  - **Hue:** colourful areas are sorted by hue, greys by brightness, with a hue offset to choose which hues land on which colour.
  - **Pick colours from photo:** chooses the 2 to 4 colours that best represent the image.
  - **Drag to reorder** colours between slots (or Alt + arrow keys).
- **Colour themes:** one-click palettes that go together (Lake, Popcorn, Game Boy, Amber Terminal, Phosphor, Blueprint, Risograph, Sunset, Sepia, Ocean, Paper & Ink). They work in both modes; in ASCII mode the darkest colour becomes the background.
- **Colour picker:** saturation/brightness field with hue slider, hex input, RGB sliders, presets, and an eyedropper that picks straight from your original photo (works in every browser) with a magnifier loupe.
- **Fade:** dissolve the top or bottom edge into one of your colours with an ordered dither, using two draggable bars on the preview. Handy for letting pixel art blend into a page background.
- **Re-open your own exports:** drop in an image that's already dithered (4 colours or fewer) and its pixels are used exactly as they are, so you can recolour it or add a fade without re-dithering.
- **Export** as SVG (runs of same-colour pixels are merged into single shapes, so it stays sharp at any size) or PNG at 1x to 8x.
- **ASCII mode:** turn the photo into text art.
  - Character sets: Classic (` .:-=+*#%@`), Detailed (a 70-character ramp), Blocks (` ░▒▓█`), Braille (each character is a 2x4 grid of dots, for about 8x the detail), or your own custom ramp.
  - The dither patterns choose which character goes where, so shading stays smooth instead of banding.
  - A background colour plus 1 to 3 text colours: each text colour takes a band of tones (shadows, midtones, highlights), dithered between neighbours so it blends instead of banding. Or tint every character with the photo's own colour instead.
  - Export: copy to clipboard, `.txt`, SVG (real text, each line pinned to an exact width so the grid lines up in any monospace font) or PNG.
- **Transparency:** see-through areas in PNG, GIF or WebP sources stay see-through, with dithered or hard edges, shown over a checkerboard. PNG, SVG and GIF exports keep it (GIF frames clear between each other, so animations don't ghost). ASCII mode can also use a transparent background, so the text floats over anything.
- Settings are remembered between visits.

## Run it yourself

It's plain HTML, CSS and JavaScript with no build step and no dependencies. Serve the folder with any static web server, for example:

```sh
python3 -m http.server 8000
```

then open http://localhost:8000/. (Opening `index.html` directly from disk also works in most browsers.)

## Files

| File | What it does |
| --- | --- |
| `index.html` | The app: layout, styles, controls, preview, eyedropper, fade bars, export |
| `dither-core.js` | The image pipeline: sampling, tone adjustments, dithering algorithms, fade, SVG export |
| `ascii.js` | ASCII mode: character sets, Braille packing, drawing, text and SVG export |
| `gif.js` | Animated GIF decoder (disposal, transparency, interlacing, local palettes) and encoder |
| `picker.js` | The colour picker popover |

## License

Copyright (C) 2026 Mike

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See [LICENSE](LICENSE).
