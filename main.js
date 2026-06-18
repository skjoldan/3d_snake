import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const GRID = 17;                 // cells per side of the cubic arena
const CELL = 1;                  // world units per cell
const HALF = (GRID - 1) / 2;     // offset so the grid is centred on the origin
const BASE_TICK = 240;           // ms between moves at the start
const MIN_TICK = 95;             // fastest the snake will ever move
const TICK_STEP = 6;             // ms shaved off per food eaten

const cellToWorld = (c) => (c - HALF) * CELL;

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
// scale fog with the arena so the far walls stay as clear as in an 11-cell grid
scene.fog = new THREE.FogExp2(0x05060a, 0.385 / (GRID * CELL));

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);
const camRadius = GRID * 1.6;
camera.position.set(camRadius, camRadius * 0.8, camRadius);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableZoom = true;
controls.minDistance = GRID;
controls.maxDistance = GRID * 3;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------
scene.add(new THREE.AmbientLight(0x6688aa, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(8, 14, 6);
scene.add(key);
const rim = new THREE.PointLight(0x4dffd2, 0.8, 60);
rim.position.set(-10, -6, -10);
scene.add(rim);

// ---------------------------------------------------------------------------
// Arena (bounding cube + faint floor grid)
// ---------------------------------------------------------------------------
const arenaSize = GRID * CELL;
const boxGeo = new THREE.BoxGeometry(arenaSize, arenaSize, arenaSize);
const edges = new THREE.LineSegments(
  new THREE.EdgesGeometry(boxGeo),
  new THREE.LineBasicMaterial({ color: 0x2a6f8f, transparent: true, opacity: 0.7 })
);
scene.add(edges);

// translucent shell so depth reads better
const shell = new THREE.Mesh(
  boxGeo,
  new THREE.MeshBasicMaterial({
    color: 0x0a2230,
    transparent: true,
    opacity: 0.06,
    side: THREE.BackSide,
  })
);
scene.add(shell);

// floor grid at the bottom face of the arena
const grid = new THREE.GridHelper(arenaSize, GRID, 0x1f5066, 0x143544);
grid.position.y = -arenaSize / 2;
scene.add(grid);

// ---------------------------------------------------------------------------
// Materials & geometry shared by snake segments
// ---------------------------------------------------------------------------
const segGeo = new THREE.BoxGeometry(CELL * 0.86, CELL * 0.86, CELL * 0.86);
const headMat = new THREE.MeshStandardMaterial({
  color: 0x58a6ff,
  emissive: 0x1b4f8f,
  emissiveIntensity: 0.6,
  metalness: 0.3,
  roughness: 0.35,
});
const bodyMat = new THREE.MeshStandardMaterial({
  color: 0x4dffd2,
  emissive: 0x0c5f4c,
  emissiveIntensity: 0.45,
  metalness: 0.2,
  roughness: 0.45,
});

// Food
const foodGeo = new THREE.IcosahedronGeometry(CELL * 0.42, 0);
const foodMat = new THREE.MeshStandardMaterial({
  color: 0xff5d8f,
  emissive: 0xff2d6f,
  emissiveIntensity: 0.9,
  metalness: 0.1,
  roughness: 0.3,
});
const food = new THREE.Mesh(foodGeo, foodMat);
const foodGlow = new THREE.PointLight(0xff5d8f, 1.2, 10);
food.add(foodGlow);
scene.add(food);

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
let snake = [];          // array of { x, y, z } cells, head first
let segMeshes = [];      // matching THREE.Mesh pool
let dir = { x: 1, y: 0, z: 0 };
let pendingDir = null;   // direction applied at the next tick
let foodCell = { x: 0, y: 0, z: 0 };
let score = 0;
let best = Number(localStorage.getItem("snake3d_best") || 0);
let tickInterval = BASE_TICK;
let lastTick = 0;
let running = false;
let paused = false;

const scoreValue = document.getElementById("scoreValue");
const bestValue = document.getElementById("bestValue");
const overlay = document.getElementById("overlay");
const pauseOverlay = document.getElementById("pauseOverlay");
bestValue.textContent = best;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const cellKey = (c) => `${c.x},${c.y},${c.z}`;
const sameCell = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
const inBounds = (c) =>
  c.x >= 0 && c.x < GRID && c.y >= 0 && c.y < GRID && c.z >= 0 && c.z < GRID;

function ensureMeshes(n) {
  while (segMeshes.length < n) {
    const m = new THREE.Mesh(segGeo, bodyMat);
    // spawn the new segment at the current tail so it doesn't streak in from the origin
    const tail = snake[snake.length - 1];
    if (tail) m.position.set(cellToWorld(tail.x), cellToWorld(tail.y), cellToWorld(tail.z));
    scene.add(m);
    segMeshes.push(m);
  }
}

function placeFood() {
  const occupied = new Set(snake.map(cellKey));
  let c;
  do {
    c = {
      x: Math.floor(Math.random() * GRID),
      y: Math.floor(Math.random() * GRID),
      z: Math.floor(Math.random() * GRID),
    };
  } while (occupied.has(cellKey(c)));
  foodCell = c;
  food.position.set(cellToWorld(c.x), cellToWorld(c.y), cellToWorld(c.z));
}

function resetGame() {
  const mid = Math.floor(GRID / 2);
  snake = [
    { x: mid, y: mid, z: mid },
    { x: mid - 1, y: mid, z: mid },
    { x: mid - 2, y: mid, z: mid },
  ];
  dir = { x: 1, y: 0, z: 0 };
  pendingDir = null;
  score = 0;
  tickInterval = BASE_TICK;
  scoreValue.textContent = 0;

  ensureMeshes(snake.length);
  segMeshes.forEach((m, i) => {
    m.visible = i < snake.length;
    if (i < snake.length) {
      const c = snake[i];
      m.position.set(cellToWorld(c.x), cellToWorld(c.y), cellToWorld(c.z));
    }
  });
  placeFood();
}

// ---------------------------------------------------------------------------
// Camera-relative steering
// ---------------------------------------------------------------------------
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

function snapAxis(v) {
  // collapse a vector in the XZ plane to the dominant grid axis
  if (Math.abs(v.x) >= Math.abs(v.z)) {
    return { x: Math.sign(v.x) || 1, y: 0, z: 0 };
  }
  return { x: 0, y: 0, z: Math.sign(v.z) || 1 };
}

function steer(intent) {
  let nd;
  if (intent === "up") nd = { x: 0, y: 1, z: 0 };
  else if (intent === "down") nd = { x: 0, y: -1, z: 0 };
  else {
    camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    _fwd.normalize();
    _right.crossVectors(_fwd, new THREE.Vector3(0, 1, 0)).normalize();

    const fAxis = snapAxis(_fwd);
    const rAxis = snapAxis(_right);
    if (intent === "forward") nd = fAxis;
    else if (intent === "back") nd = { x: -fAxis.x, y: 0, z: -fAxis.z };
    else if (intent === "right") nd = rAxis;
    else if (intent === "left") nd = { x: -rAxis.x, y: 0, z: -rAxis.z };
  }
  if (!nd) return;

  // ignore a direct 180° reversal — it would be instant death
  const cur = pendingDir || dir;
  if (nd.x === -cur.x && nd.y === -cur.y && nd.z === -cur.z) return;
  pendingDir = nd;
}

// ---------------------------------------------------------------------------
// Tick: advance the simulation by one cell
// ---------------------------------------------------------------------------
function tick() {
  if (pendingDir) {
    dir = pendingDir;
    pendingDir = null;
  }

  const head = snake[0];
  const next = { x: head.x + dir.x, y: head.y + dir.y, z: head.z + dir.z };

  if (!inBounds(next)) return gameOver();

  const willGrow = sameCell(next, foodCell);
  const body = willGrow ? snake : snake.slice(0, snake.length - 1);
  for (const seg of body) {
    if (sameCell(seg, next)) return gameOver();
  }

  snake.unshift(next);
  if (willGrow) {
    score++;
    scoreValue.textContent = score;
    tickInterval = Math.max(MIN_TICK, BASE_TICK - score * TICK_STEP);
    placeFood();
    pulse = 1; // food-eaten flash
  } else {
    snake.pop();
  }

  ensureMeshes(snake.length);
  segMeshes.forEach((m, i) => {
    m.visible = i < snake.length;
    m.material = i === 0 ? headMat : bodyMat;
  });
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------
function startGame() {
  resetGame();
  overlay.classList.add("hidden");
  pauseOverlay.classList.add("hidden");
  paused = false;
  running = true;
  lastTick = performance.now();
}

function gameOver() {
  running = false;
  if (score > best) {
    best = score;
    localStorage.setItem("snake3d_best", best);
    bestValue.textContent = best;
  }
  showGameOver();
}

function togglePause() {
  if (!running) return;
  paused = !paused;
  pauseOverlay.classList.toggle("hidden", !paused);
  if (!paused) lastTick = performance.now();
}

function showGameOver() {
  const isRecord = score === best && score > 0;
  overlay.innerHTML = `
    <div class="panel">
      <h2>GAME OVER</h2>
      <p id="finalScore">Score: <span>${score}</span>${
        isRecord ? " &nbsp;🏆 new best!" : ""
      }</p>
      <button id="restartButton">PLAY AGAIN</button>
      <p class="hint">Tip: rotate the camera before a tight turn so your<br>steering lines up with what you see.</p>
    </div>`;
  overlay.classList.remove("hidden");
  document.getElementById("restartButton").addEventListener("click", startGame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keyMap = {
  KeyW: "forward", ArrowUp: "forward",
  KeyS: "back", ArrowDown: "back",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
  KeyE: "up", Space: "up",
  KeyQ: "down", ShiftLeft: "down",
};

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyP") {
    togglePause();
    return;
  }
  const intent = keyMap[e.code];
  if (intent && running && !paused) {
    e.preventDefault();
    steer(intent);
  }
});

document.getElementById("startButton").addEventListener("click", startGame);
document.getElementById("resumeButton").addEventListener("click", togglePause);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Render loop (with smooth interpolation between cells)
// ---------------------------------------------------------------------------
let pulse = 0;
const _target = new THREE.Vector3();

function animate(now) {
  requestAnimationFrame(animate);

  if (running && !paused && now - lastTick >= tickInterval) {
    lastTick = now;
    tick();
  }

  // smoothly ease each segment toward its logical cell
  const smooth = 0.28;
  for (let i = 0; i < snake.length; i++) {
    const c = snake[i];
    const m = segMeshes[i];
    if (!m) continue;
    _target.set(cellToWorld(c.x), cellToWorld(c.y), cellToWorld(c.z));
    m.position.lerp(_target, smooth);
  }

  // food pulse + spin
  const t = now * 0.001;
  pulse *= 0.9;
  const s = 1 + 0.12 * Math.sin(t * 4) + pulse * 0.6;
  food.scale.setScalar(s);
  food.rotation.y = t * 1.2;
  food.rotation.x = t * 0.7;
  foodGlow.intensity = 1.0 + 0.4 * Math.sin(t * 4);

  controls.update();
  renderer.render(scene, camera);
}

requestAnimationFrame(animate);
