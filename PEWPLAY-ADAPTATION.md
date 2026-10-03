# Color Collision for PewPlay

This directory contains the original static game adapted for the PewPlay game template. Open `index.html` to play.

`game.json` holds the game page text. `preview.png` and `cover.png` provide the page images. The PewPlay workflow checks pushes to `preview` and `main`. The game remains a draft until you remove `"draft": true` after reviewing it.

Game controls: Change the center balls to the color needed to survive the incoming collisions. Keep matching as the pace increases.

## Update (October 2026)

- Rewrote `script.js` cleanly: time-based loop (same speeds as the original 60 fps version), full-screen high-DPI canvas recalculated on resize/rotation, central balls scaled to the screen.
- Removed the external Splitting.js and Google Fonts requests.
- HTML HUD with score, best score (`color-collision:best`), pause and mute buttons; in-page start, pause and game over panels.
- Sound effects with Web Audio (started after the first gesture, mute saved under `color-collision:muted`); keyboard support (Space/Enter/arrows, P/Esc, M).
- Fixed: the canvas not resizing (only its height changed, and the central balls stayed in the old position) and the erratic frame-count spawn timer.
- New cover and screenshots.
