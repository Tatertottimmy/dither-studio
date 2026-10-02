# Dither Studio

Turn a photo into a dithered image in 2 to 4 colours, right in the browser, and export it as a crisp vector SVG or a pixel-perfect PNG.

**Try it:** https://mikemadeit.io/dither/

Everything runs locally in your browser. Photos are never uploaded anywhere.

## Features

- **Load a photo** by dragging it onto the page, pasting it, or choosing a file.
- **Dither patterns:** Floyd-Steinberg, Atkinson, Bayer 2x2 / 4x4 / 8x8 (ordered), or plain threshold.
- **Tone controls:** pixel density (dots across), brightness, contrast, gamma and sharpen, with a live preview. Scroll over any slider to nudge it (Shift for bigger steps).
- **2 to 4 colours,** ordered darkest to lightest. Each colour takes an equal band of the image's tones, with dithered blends in between.
- **Colour picker:** saturation/brightness field with hue slider, hex input, RGB sliders, presets, and an eyedropper that picks straight from your original photo (works in every browser) with a magnifier loupe.
- **Fade:** dissolve the top or bottom edge into one of your colours with an ordered dither, using two draggable bars on the preview. Handy for letting pixel art blend into a page background.
- **Re-open your own exports:** drop in an image that's already dithered (4 colours or fewer) and its pixels are used exactly as they are, so you can recolour it or add a fade without re-dithering.
- **Export** as SVG (runs of same-colour pixels are merged into single shapes, so it stays sharp at any size) or PNG at 1x to 8x.
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
| `picker.js` | The colour picker popover |

## License

Copyright (C) 2026 Mike

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See [LICENSE](LICENSE).
