# Third-Party Notices

## Runtime Dependencies and Generated Icons

The production build includes dependency license texts in
`dist/THIRD_PARTY_LICENSES.txt` (installed at `resources/backend/dist/`).
Backend dependency licenses are also retained in their bundled package folders.
Electron and Node.js carry their own license notices in the installation.

The SVG icons in `public/mascot/` are generated from Lucide React icons.
They retain the following upstream notice, independent of the mascot artwork policy:

ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## Adapted Color Seed Presets

The `classic-blue` and `classic-pink` seed palettes in `shared/skins.mjs`
are adapted from `qq-2007.json` and `qq-2008.json` in:
https://github.com/HeiGeAi/deepseek-harness-skin

Only the four color seeds have been reused. No upstream application code,
wallpapers, character artwork, fonts, logos, icons, or executable plugins
are bundled. The original preset names are not used as Agent Desk brands.

MIT License

Copyright (c) 2026 HeiGeAi (Blake Xu)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Design References, Not Bundled Plugins

- https://github.com/Small-tailqwq/dsh-deep-whale
- https://github.com/zhu1090093659/dsh-web-ui
- https://github.com/WYH66666666/DSH-Transparent-UI-Plugin
- https://github.com/dsh-tui/dsh-tui

These projects have different host/plugin contracts. Agent Desk does not
load their JavaScript, CSS, npm bundles, terminal drivers, or character assets.
Its appearance engine, glass materials, gallery, wallpaper processing, and
data-only importer are independently implemented. The importer accepts only
Harness seed JSON (name, appearance, accent/secondary/surface/text) and Agent
Desk v1 skin JSON, not arbitrary Harness plugins or all token formats.

## Original Wallpaper

`public/wallpapers/alpine.webp` was generated using the built-in image
generation tool for this project. Prompt: an original panoramic editorial
photograph of an alpine glacial lake, silver clouds, rugged mountains,
emerald pines, turquoise reflections, no people, text, logos, or interface.
The full generation prompt is recorded in `public/wallpapers/provenance.json`.

`public/wallpapers/anime-rin.webp` is an original anime-style character
illustration generated for Agent Desk, not a reused DeepSeek mascot or
third-party character. The full prompt is in
`public/wallpapers/anime-rin.provenance.json`. The generated image and name
are a visual skin, not a change to the selected model or its system prompt.

## Taoling Mascot

Taoling (桃铃, nickname 桃桃) is the original pink-haired catgirl maid concept
approved by the user for Agent Desk. The standing illustration, avatar,
application icon and mini companion derive from that approved design using
the built-in image generation tool. No Arknights: Endfield character,
uniform, insignia, artwork or game logo is included. The reference is art
direction only. Full prompts and asset relationships are in
`public/mascot/provenance.json`; the approved concept sheet and original mini
are retained in `design/mascot/pink-maid-concept-01/`.

The full-window catnap wallpaper and happy head-pat expression are generated
derivatives of the same design. Their full prompts and references are recorded
in `public/mascot/catnap-provenance.json`.
