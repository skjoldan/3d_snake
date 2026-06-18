# 3D Snake

The classic Nokia *Snake*, reimagined inside a cubic 3D arena. Eat the glowing
orbs to grow, but don't crash into the walls or your own tail — and now you have
a whole extra dimension to worry about.

Built with [Three.js](https://threejs.org/) (loaded from a CDN), so there's no
build step and no dependencies to install.

## Play

Because the game uses ES module imports, it needs to be served over HTTP (opening
`index.html` directly via `file://` will be blocked by the browser). Any static
server works:

```bash
# Python (already on most systems)
python3 -m http.server 8000

# …or Node
npx serve .
```

Then open <http://localhost:8000> in a modern browser.

## Controls

| Key            | Action                          |
| -------------- | ------------------------------- |
| `W A S D`      | Move in the horizontal plane    |
| `Q` / `E`      | Move down / up                  |
| Arrow keys     | Also steer horizontally         |
| `Space`        | Move up                         |
| Mouse drag     | Orbit the camera                |
| Scroll         | Zoom in / out                   |
| `P`            | Pause / resume                  |

**Steering is relative to the camera.** `W` always goes "away from you" and `D`
always goes "to your right" based on where the camera is pointing, snapped to the
nearest grid axis. Rotate the view before a tricky turn so your controls line up
with what you see.

## How it works

- The arena is an `11 × 11 × 11` grid of cells centred on the origin.
- The snake advances one cell per tick; ticks speed up as your score climbs.
- Segments smoothly interpolate toward their logical cells each frame for a fluid
  trailing motion.
- Your best score is saved in `localStorage`.

All the game logic lives in [`main.js`](main.js); tweak the constants at the top
(`GRID`, `BASE_TICK`, `MIN_TICK`, …) to change the arena size or difficulty.
