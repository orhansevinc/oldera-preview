WS43

# Display compatibility test artifacts

The Playwright suite writes runtime evidence here. Expected generated files include:

- `1024x768.png` / `.json`
- `1280x720.png` / `.json`
- `1366x768.png` / `.json`
- `1920x1080.png` / `.json`
- `1280x720-high-dpi.png` / `.json`
- `zoom-125-equivalent-1024x576.png` / `.json`
- `resize-900x1000.png`
- `fullscreen.json`

Screenshots are deliberately taken from `openko-web/index.html`, which loads the real Emscripten `KnightOnLine.js` canvas. The tests do not use the repository's HTML/Three.js mock client as evidence.

The `zoom-125-equivalent` case is a CSS viewport reduction equivalent, not a claim that Playwright changed the Chromium toolbar zoom setting. Real browser-chrome zoom remains a manual integration check.
