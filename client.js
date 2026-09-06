/**
 * Bao im Bambuswald — endless runner.
 *
 * Everything that moves lives here: physics, spawning, collisions, drawing and
 * audio. The room (see ../src/logic.js) only stores this browser's best run, so
 * a lost connection never stops the game.
 */

// ── net ───────────────────────────────────────────────────────────────────

function playerId() {
  const key = "hf:game:playerId";
  let id = localStorage.getItem(key);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    localStorage.setItem(key, id);
  }
  return id;
}
const ME = playerId();
const room = `p-${ME}`;
const PING = "__ping";
const PONG = "__pong";
let socket = null;
let retry = 0;

function connect() {
  return; // static hosting (GitHub Pages): no record server, best score stays in this browser
  // eslint-disable-next-line no-unreachable
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  try {
    socket = new WebSocket(`${proto}//${location.host}/ws/${encodeURIComponent(room)}`);
  } catch {
    return;
  }
  socket.addEventListener("open", () => {
    retry = 0;
    send({ type: "join", playerId: ME });
  });
  socket.addEventListener("message", (event) => {
    if (event.data === PONG) return;
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "state" && msg.view && typeof msg.view.best === "number") {
      if (msg.view.best > best) {
        best = msg.view.best;
        localStorage.setItem("bao:best", String(best));
        updateHud();
      }
    }
  });
  socket.addEventListener("close", () => {
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 500 * 2 ** (retry - 1));
  });
}
function send(msg) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}
setInterval(() => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(PING);
}, 30_000);

// ── dom ───────────────────────────────────────────────────────────────────

const $ = (s) => document.querySelector(s);
const canvas = $("#game");
const ctx = canvas.getContext("2d");
const el = {
  hud: $("#hud"), score: $("#score"), best: $("#best"), level: $("#levelpill"), shield: $("#shield"),
  mute: $("#mute"), banner: $("#banner"), title: $("#title"), titlebest: $("#titlebest"),
  over: $("#over"), overtitle: $("#overtitle"), overtext: $("#overtext"), overscore: $("#overscore"),
  overleaves: $("#overleaves"), overlevel: $("#overlevel"), overbest: $("#overbest"),
  start: $("#start"), retry: $("#retry"), tapzone: $("#tapzone"),
};

// ── assets ────────────────────────────────────────────────────────────────

const IMG = {};
const IMAGE_NAMES = ["panda_run", "panda_jump", "panther", "lion", "leaf", "leaf_gold", "sprout", "spear"];
function loadImages() {
  return Promise.all(
    IMAGE_NAMES.map(
      (n) =>
        new Promise((res) => {
          const i = new Image();
          i.onload = () => res();
          i.onerror = () => res();
          i.src = `assets/${n}.png`;
          IMG[n] = i;
        }),
    ),
  );
}

let muted = localStorage.getItem("bao:muted") === "1";
const SFX_NAMES = ["jump", "land", "leaf", "gold", "boost", "panther", "squash", "roar", "bosshit", "bosswin", "gameover", "shield", "shieldbreak", "levelup"];
const SFX = {};
for (const n of SFX_NAMES) {
  const a = new Audio(`audio/sfx_${n}.mp3`);
  a.preload = "auto";
  SFX[n] = a;
}
const SFX_GAIN = { jump: 0.35, land: 0.3, leaf: 0.4, gold: 0.5, boost: 0.5, panther: 0.45, squash: 0.5, roar: 0.6, bosshit: 0.55, bosswin: 0.6, gameover: 0.55, shield: 0.45, shieldbreak: 0.5, levelup: 0.6 };
const lastSfx = {};
function sfx(name) {
  if (muted) return;
  const now = performance.now();
  if (lastSfx[name] && now - lastSfx[name] < 60) return;
  lastSfx[name] = now;
  try {
    const a = SFX[name].cloneNode();
    a.volume = SFX_GAIN[name] ?? 0.4;
    a.play().catch(() => {});
  } catch {
    /* audio unavailable */
  }
}
let music = null;
let musicName = null;
function playMusic(name) {
  if (musicName === name) {
    if (music && !muted && music.paused) music.play().catch(() => {});
    return;
  }
  if (music) {
    music.pause();
    music = null;
  }
  musicName = name;
  if (!name) return;
  music = new Audio(`audio/${name}.m4a`);
  music.loop = true;
  music.volume = 0.3;
  if (!muted) music.play().catch(() => {});
}
function setMuted(m) {
  muted = m;
  localStorage.setItem("bao:muted", m ? "1" : "0");
  el.mute.textContent = m ? "🔇" : "🔊";
  if (music) {
    if (m) music.pause();
    else music.play().catch(() => {});
  }
}
el.mute.addEventListener("click", (e) => {
  e.stopPropagation();
  setMuted(!muted);
});
el.mute.addEventListener("pointerdown", (e) => e.stopPropagation());
el.mute.textContent = muted ? "🔇" : "🔊";

// ── world constants ───────────────────────────────────────────────────────

const H = 540;
let W = 960;
const GROUND = 462;
const GRAVITY = 2500;
const JUMP_V = -1060; // full (held) jump ≈ 224 px
const JUMP_MIN_T = 0.18; // a tap always rises this long ≈ 164 px
const JUMP_CUT_V = -260; // remaining rise after an early release ≈ 15 px

const LEVELS = [
  {
    name: "Morgengrauen", sub: "Level 1", speed: 330, dist: 10500, bossHits: 3, roar: false, bossJumps: false,
    sky: ["#ffb26b", "#ffe2a8", "#bfe9ff"], sun: { x: 0.78, y: 0.62, r: 46, c: "#fff0a0" },
    far: "#a6d8a3", mid: "#6fbf73", near: "#3f9a4a", ground: "#7ccd5a", groundDark: "#4e9a3a",
    fog: 0.12, fogColor: "255,240,210", fireflies: 0, stars: 0, music: "music_l1",
  },
  {
    name: "Mittag", sub: "Level 2", speed: 410, dist: 13500, bossHits: 4, roar: true, bossJumps: false,
    sky: ["#3fa9ff", "#8fd4ff", "#e6f7ff"], sun: { x: 0.5, y: 0.14, r: 40, c: "#fffbe0" },
    far: "#88c48c", mid: "#4f9f58", near: "#2f7d3a", ground: "#6dbd4f", groundDark: "#3f8a30",
    fog: 0.38, fogColor: "230,245,235", fireflies: 0, stars: 0, music: "music_l2",
  },
  {
    name: "Nacht", sub: "Level 3", speed: 490, dist: 16500, bossHits: 5, roar: true, bossJumps: true,
    sky: ["#070b1f", "#182a5a", "#2b4a7a"], sun: { x: 0.8, y: 0.16, r: 34, c: "#f4f1d8" },
    far: "#1e3d3f", mid: "#17462c", near: "#0f3320", ground: "#2c6f45", groundDark: "#1a4a2c",
    fog: 0.18, fogColor: "90,120,160", fireflies: 42, stars: 90, music: "music_l3",
  },
];

// ── state ─────────────────────────────────────────────────────────────────

let best = Number(localStorage.getItem("bao:best") || 0);
let G = null;
let jumpHeld = false;
let lastTime = 0;

function newGame() {
  G = {
    mode: "title", level: 0, score: 0, leaves: 0, streak: 0, shield: false, boost: 0, dist: 0,
    speed: LEVELS[0].speed, t: 0, ents: [], parts: [], nextSpawn: 600, boss: null, shake: 0,
    modeT: 0, hitFlash: 0, fireflies: [], stars: [], scoreFloat: [], lastCause: "",
    panda: { x: 0, y: GROUND, vy: 0, onGround: true, w: 86, h: 102, prevBottom: GROUND, inv: 0, squash: 0, coyote: 0, buffer: 0, airT: 0, cut: false },
  };
  G.panda.x = Math.round(W * 0.2);
  for (let i = 0; i < 60; i++) G.fireflies.push({ x: Math.random() * W, y: 80 + Math.random() * 340, p: Math.random() * 6.28, s: 0.6 + Math.random() * 0.8 });
  for (let i = 0; i < 120; i++) G.stars.push({ x: Math.random(), y: Math.random() * 0.6, r: Math.random() * 1.6 + 0.4, p: Math.random() * 6.28 });
}

function L() {
  return LEVELS[G.level];
}

function startRun() {
  newGame();
  G.mode = "playing";
  G.modeT = 0;
  el.title.hidden = true;
  el.over.hidden = true;
  el.hud.hidden = false;
  showBanner(L().sub, L().name);
  playMusic(L().music);
  updateHud();
}

function nextLevel() {
  G.level++;
  G.dist = 0;
  G.ents = [];
  G.boss = null;
  G.speed = L().speed;
  G.nextSpawn = 700;
  G.mode = "playing";
  G.modeT = 0;
  G.panda.inv = 1.0;
  showBanner(L().sub, L().name);
  playMusic(L().music);
  updateHud();
}

function endRun(won) {
  G.mode = won ? "win" : "over";
  G.modeT = 0;
  if (!won) {
    sfx("gameover");
    playMusic(null);
    setTimeout(() => {
      if (G.mode === "over") playMusic("music_title");
    }, 1400);
  } else {
    playMusic("music_title");
  }
  if (G.score > best) {
    best = G.score;
    localStorage.setItem("bao:best", String(best));
  }
  send({ type: "action", action: { type: "run", score: G.score, level: G.level + 1, leaves: G.leaves } });
  el.overtitle.textContent = won ? "Gewonnen! 🎉" : "Game Over";
  el.overtext.textContent = won
    ? "Bao hat alle drei Löwen besiegt und den Bambuswald gerettet!"
    : G.lastCause === "spear"
      ? "Autsch, ein Bambusspeer!"
      : G.lastCause === "panther"
        ? "Der Panther war schneller."
        : "Der Löwe hat gewonnen … diesmal.";
  el.overscore.textContent = String(G.score);
  el.overleaves.textContent = String(G.leaves);
  el.overlevel.textContent = String(G.level + 1);
  el.overbest.textContent = G.score >= best && G.score > 0 ? "Neuer Rekord!" : `Rekord: ${best}`;
  setTimeout(() => {
    el.over.hidden = false;
  }, won ? 1800 : 900);
  updateHud();
}

// ── ui ────────────────────────────────────────────────────────────────────

function updateHud() {
  el.score.textContent = String(G ? G.score : 0);
  el.best.textContent = String(best);
  el.level.textContent = G ? `${L().sub} · ${L().name}` : "";
  el.shield.dataset.on = G && G.shield ? "1" : "0";
  el.titlebest.textContent = best > 0 ? `Dein Rekord: ${best} Punkte` : "";
}
let bannerTimer = 0;
function showBanner(big, small) {
  el.banner.innerHTML = "";
  el.banner.append(document.createTextNode(big));
  if (small) {
    const s = document.createElement("small");
    s.textContent = small;
    el.banner.append(s);
  }
  el.banner.classList.add("show");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.banner.classList.remove("show"), 1900);
}

// ── input ─────────────────────────────────────────────────────────────────

function press() {
  if (!G) return;
  if (G.mode === "title") return startRun();
  if (G.mode === "over" || G.mode === "win") {
    if (!el.over.hidden) startRun();
    return;
  }
  jumpHeld = true;
  jump();
}
function release() {
  jumpHeld = false;
}
function jump() {
  const p = G.panda;
  if (G.mode !== "playing" && G.mode !== "boss") return;
  if (p.onGround || p.coyote > 0) {
    p.vy = JUMP_V;
    p.onGround = false;
    p.coyote = 0;
    p.airT = 0;
    p.cut = false;
    p.squash = -0.18;
    sfx("jump");
    for (let i = 0; i < 6; i++) spawnPart(p.x + p.w / 2, GROUND, "dust");
  } else {
    p.buffer = 0.12;
  }
}
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
    e.preventDefault();
    press();
  }
  if (e.code === "KeyM") setMuted(!muted);
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") release();
});
el.tapzone.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  press();
});
window.addEventListener("pointerup", release);
window.addEventListener("pointercancel", release);
el.start.addEventListener("click", (e) => {
  e.stopPropagation();
  startRun();
});
el.retry.addEventListener("click", (e) => {
  e.stopPropagation();
  startRun();
});
el.title.addEventListener("pointerdown", (e) => {
  if (e.target.closest("button")) return;
  press();
});
el.over.addEventListener("pointerdown", (e) => {
  if (e.target.closest("button")) return;
  press();
});

// ── spawning ──────────────────────────────────────────────────────────────

const PATTERNS = {
  leafline: [30, 24, 20], leafarc: [14, 12, 10], gold: [6, 6, 6], sprout: [4, 4, 5],
  spear1: [20, 12, 8], spear2: [6, 12, 10], spear3: [0, 6, 8], hang: [0, 0, 12], tall: [6, 10, 12], tall2: [0, 4, 8],
  panther: [12, 14, 12], panther2: [0, 10, 12],
};
function pickPattern() {
  const lv = G.level;
  let total = 0;
  for (const k in PATTERNS) total += PATTERNS[k][lv];
  let r = Math.random() * total;
  for (const k in PATTERNS) {
    r -= PATTERNS[k][lv];
    if (r <= 0) return k;
  }
  return "leafline";
}
function add(e) {
  G.ents.push(e);
  return e;
}
function leaf(x, y, gold = false) {
  return add({ type: gold ? "gold" : "leaf", x, y, w: gold ? 46 : 40, h: gold ? 34 : 40, r: Math.random() * 6.28 });
}
function spear(x, hanging = false, tall = false) {
  return add({ type: "spear", x, w: tall ? 26 : 22, h: tall ? 190 : 104, hanging, tall });
}
function panther(x) {
  return add({ type: "panther", x, y: GROUND, w: 118, h: 64, vx: -(90 + G.level * 30), announced: false, anim: Math.random() * 6, dead: false, deadT: 0 });
}
function spawnPattern(x) {
  const k = pickPattern();
  const lift = GROUND - 62;
  switch (k) {
    case "leafline": {
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) leaf(x + i * 46, lift);
      return n * 46 + 60;
    }
    case "leafarc": {
      for (let i = 0; i < 5; i++) leaf(x + i * 48, GROUND - 90 - Math.sin((i / 4) * Math.PI) * 110);
      return 5 * 48 + 60;
    }
    case "gold":
      leaf(x, GROUND - 300, true);
      return 120;
    case "sprout":
      add({ type: "sprout", x, y: GROUND, w: 36, h: 56 });
      return 120;
    case "spear1":
      spear(x);
      if (Math.random() < 0.5) for (let i = 0; i < 3; i++) leaf(x - 40 + i * 40, GROUND - 170 - (i === 1 ? 30 : 0));
      return 140;
    case "spear2":
      spear(x);
      spear(x + 28);
      return 170;
    case "spear3":
      spear(x);
      spear(x + 28);
      spear(x + 56);
      if (Math.random() < 0.5) leaf(x + 28, GROUND - 300, true);
      return 210;
    case "tall":
      spear(x, false, true);
      if (Math.random() < 0.5) leaf(x + 13, GROUND - 300, true);
      return 150;
    case "tall2":
      spear(x, false, true);
      spear(x + 32, false, true);
      return 190;
    case "hang":
      spear(x, true);
      leaf(x - 50, lift);
      leaf(x, lift);
      leaf(x + 50, lift);
      return 200;
    case "panther":
      panther(x + 60);
      return 200;
    case "panther2":
      panther(x + 60);
      panther(x + 60 + 170);
      return 380;
  }
  return 150;
}

function spawnPart(x, y, kind) {
  const a = Math.random() * 6.28;
  const s = kind === "dust" ? 60 + Math.random() * 80 : 120 + Math.random() * 200;
  G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (kind === "dust" ? 60 : 100), life: 0.5 + Math.random() * 0.4, kind, r: 3 + Math.random() * 4 });
}
function floatText(x, y, text, color) {
  G.scoreFloat.push({ x, y, text, color, life: 0.9 });
}

// ── update ────────────────────────────────────────────────────────────────

function update(dt) {
  if (!G) return;
  G.t += dt;
  G.modeT += dt;
  if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 4);
  if (G.hitFlash > 0) G.hitFlash -= dt * 3;

  const active = G.mode === "playing" || G.mode === "boss" || G.mode === "clear";
  if (!active && G.mode !== "over") {
    updateParticles(dt);
    return;
  }
  if (G.mode === "over") {
    const p = G.panda;
    p.vy += GRAVITY * dt;
    p.y += p.vy * dt;
    if (p.y > H + 200) p.y = H + 200;
    updateParticles(dt);
    return;
  }

  const lv = L();
  const boostMul = G.boost > 0 ? 1.55 : 1;
  const speed = G.speed * boostMul;
  const dx = speed * dt;
  G.dist += dx;
  if (G.boost > 0) G.boost -= dt;
  if (G.mode === "playing") G.speed = Math.min(lv.speed * 1.22, G.speed + dt * 2.2);

  // ── panda physics
  const p = G.panda;
  p.prevBottom = p.y;
  p.airT += dt;
  if (!jumpHeld && !p.cut && p.vy < 0 && p.airT >= JUMP_MIN_T) {
    p.cut = true;
    if (p.vy < JUMP_CUT_V) p.vy = JUMP_CUT_V;
  }
  p.vy += GRAVITY * dt;
  p.y += p.vy * dt;
  if (p.coyote > 0) p.coyote -= dt;
  if (p.buffer > 0) p.buffer -= dt;
  if (p.y >= GROUND) {
    if (!p.onGround) {
      sfx("land");
      p.squash = 0.22;
      for (let i = 0; i < 5; i++) spawnPart(p.x + p.w / 2, GROUND, "dust");
    }
    p.y = GROUND;
    p.vy = 0;
    p.onGround = true;
    p.coyote = 0.08;
    if (p.buffer > 0) {
      p.buffer = 0;
      jump();
    }
  }
  if (p.squash !== 0) p.squash *= Math.max(0, 1 - dt * 9);
  if (p.inv > 0) p.inv -= dt;

  // ── spawning (only while running freely)
  if (G.mode === "playing") {
    if (G.dist >= lv.dist) {
      G.mode = "boss";
      G.modeT = 0;
      G.boss = { x: W + 260, y: GROUND, vy: 0, w: 214, h: 142, hp: lv.bossHits, maxHp: lv.bossHits, state: "enter", timer: 0, flash: 0, roars: 0, anim: 0, hopped: false };
      showBanner("Der Löwe!", "Spring ihm auf den Kopf");
      playMusic("music_boss");
      sfx("roar");
      G.shake = 1;
    } else if (G.dist >= G.nextSpawn) {
      const width = spawnPattern(W + 80);
      const gap = speed * (0.75 + Math.random() * 0.55) + width;
      G.nextSpawn = G.dist + gap;
    }
  } else if (G.mode === "boss" && G.boss) {
    if (G.dist >= G.nextSpawn) {
      for (let i = 0; i < 2; i++) leaf(W + 80 + i * 46, GROUND - 62);
      G.nextSpawn = G.dist + 1500 + Math.random() * 1000;
    }
    updateBoss(dt, speed);
  }

  // ── entities
  const pb = pandaBox();
  for (let i = G.ents.length - 1; i >= 0; i--) {
    const e = G.ents[i];
    e.x -= dx;
    if (e.type === "panther") {
      e.x += e.vx * dt;
      e.anim += dt * 12;
      if (!e.announced && e.x < W + 40) {
        e.announced = true;
        sfx("panther");
      }
    }
    if (e.type === "shot") e.x += e.vx * dt;
    if (e.type === "leaf" || e.type === "gold") e.r += dt * 2;
    if (e.x + (e.w || 0) < -200) {
      G.ents.splice(i, 1);
      continue;
    }
    if (e.dead) {
      e.deadT += dt;
      if (e.deadT > 0.7) G.ents.splice(i, 1);
      continue;
    }
    const eb = entBox(e);
    if (!overlap(pb, eb)) continue;
    if (e.type === "leaf" || e.type === "gold") {
      G.ents.splice(i, 1);
      const pts = e.type === "gold" ? 5 : 1;
      G.score += pts;
      G.leaves++;
      sfx(e.type === "gold" ? "gold" : "leaf");
      floatText(e.x, e.y - 20, `+${pts}`, e.type === "gold" ? "#ffd54a" : "#b9ff7a");
      for (let k = 0; k < (e.type === "gold" ? 10 : 4); k++) spawnPart(e.x, e.y, e.type === "gold" ? "gold" : "leaf");
      G.streak++;
      if (G.streak >= 10 && !G.shield) {
        G.shield = true;
        G.streak = 0;
        sfx("shield");
        floatText(p.x + p.w / 2, p.y - p.h - 20, "SCHILD!", "#7be0ff");
      }
      updateHud();
    } else if (e.type === "sprout") {
      G.ents.splice(i, 1);
      G.boost = 3;
      G.score += 3;
      sfx("boost");
      floatText(e.x, e.y - 60, "TURBO!", "#ffffff");
      for (let k = 0; k < 12; k++) spawnPart(e.x, e.y - 20, "gold");
      updateHud();
    } else if (e.type === "panther") {
      const stomp = p.prevBottom <= eb.y + 26 || (p.vy > 0 && p.y <= eb.y + 34);
      if (stomp || G.boost > 0) {
        e.dead = true;
        e.deadT = 0;
        p.vy = -520;
        p.onGround = false;
        G.score += 20;
        sfx("squash");
        floatText(e.x + e.w / 2, e.y - 80, "+20", "#ffffff");
        for (let k = 0; k < 10; k++) spawnPart(e.x + e.w / 2, e.y - 30, "star");
        updateHud();
      } else {
        hurt("panther", e);
      }
    } else if (e.type === "shot") {
      if (G.boost > 0) {
        G.ents.splice(i, 1);
        for (let k = 0; k < 8; k++) spawnPart(e.x + 50, e.y, "dust");
      } else hurt("spear", e);
    } else if (e.type === "spear") {
      if (G.boost > 0) {
        G.ents.splice(i, 1);
        for (let k = 0; k < 8; k++) spawnPart(e.x + 11, GROUND - 50, "dust");
      } else hurt("spear", e);
    }
  }

  // ── boss collision
  if (G.boss && G.mode === "boss" && G.boss.state !== "dead") {
    const b = G.boss;
    const bb = { x: b.x + 30, y: b.y - b.h + 12, w: b.w - 60, h: b.h - 12 };
    if (b.state !== "retreat" && overlap(pb, bb)) {
      const stomp = p.prevBottom <= bb.y + bb.h * 0.65 || (p.vy > 0 && p.y <= bb.y + bb.h * 0.75);
      if (stomp) {
        b.hp--;
        b.flash = 0.35;
        b.state = "retreat";
        b.timer = 0;
        b.vy = 0;
        b.y = GROUND;
        p.vy = -640;
        p.onGround = false;
        G.score += 50;
        G.shake = 0.6;
        sfx("bosshit");
        floatText(b.x + b.w / 2, b.y - b.h - 20, "+50", "#ffffff");
        for (let k = 0; k < 14; k++) spawnPart(b.x + b.w / 2, b.y - b.h + 30, "star");
        if (b.hp <= 0) {
          b.state = "dead";
          b.vy = -700;
          G.mode = "clear";
          G.modeT = 0;
          G.score += 200;
          sfx("bosswin");
          setTimeout(() => sfx("levelup"), 900);
          playMusic(null);
          showBanner("Level geschafft!", "+200");
        }
        updateHud();
      } else {
        hurt("lion", b);
      }
    }
  }

  if (G.mode === "clear") {
    const b = G.boss;
    if (b) {
      b.vy += GRAVITY * 0.6 * dt;
      b.y += b.vy * dt;
      b.x += 260 * dt;
      b.anim += dt * 10;
    }
    if (G.modeT > 2.6) {
      if (G.level >= LEVELS.length - 1) endRun(true);
      else nextLevel();
    }
  }

  updateParticles(dt);
}

function updateBoss(dt, speed) {
  const b = G.boss;
  const lv = L();
  const p = G.panda;
  b.anim += dt * 8;
  b.timer += dt;
  if (b.flash > 0) b.flash -= dt;
  const home = W - b.w - 40;
  switch (b.state) {
    case "enter":
      b.x -= (speed * 0.5 + 200) * dt;
      if (b.x <= home) {
        b.x = home;
        b.state = "idle";
        b.timer = 0;
      }
      break;
    case "idle": {
      b.x = home + Math.sin(b.anim) * 4;
      const wait = Math.max(0.6, 1.3 - G.level * 0.25);
      if (b.timer > wait) {
        b.timer = 0;
        if (lv.roar && b.roars % 2 === 1) {
          b.state = "roar";
          b.roars++;
          sfx("roar");
          G.shake = 0.8;
          if (G.level >= 2) {
            const vx = -(speed * 0.3 + 200);
            add({ type: "shot", x: W + 40, y: GROUND - 26, w: 104, h: 20, vx });
            add({ type: "shot", x: W + 300, y: GROUND - 138, w: 104, h: 20, vx });
            add({ type: "shot", x: W + 560, y: GROUND - 26, w: 104, h: 20, vx });
          } else {
            for (let i = 0; i < 2; i++) add({ type: "spear", x: W + 60 + i * 30, w: 22, h: 104, hanging: false, tall: false });
          }
        } else {
          b.roars++;
          b.state = "charge";
          b.hopped = false;
        }
      }
      break;
    }
    case "roar":
      if (b.timer > 0.9) {
        b.state = "idle";
        b.timer = 0;
      }
      break;
    case "charge": {
      b.x -= (speed * 0.4 + 170 + G.level * 40) * dt;
      if (lv.bossJumps && !b.hopped && b.x < p.x + 380 && b.y >= GROUND) {
        b.hopped = true;
        b.vy = -560;
      }
      if (b.y < GROUND || b.vy !== 0) {
        b.vy += GRAVITY * 0.9 * dt;
        b.y += b.vy * dt;
        if (b.y >= GROUND) {
          b.y = GROUND;
          b.vy = 0;
          G.shake = Math.max(G.shake, 0.4);
        }
      }
      if (b.x + b.w < p.x - 60) {
        b.state = "retreat";
        b.timer = 0;
      }
      break;
    }
    case "retreat":
      b.x += (speed * 0.9 + 260) * dt;
      if (b.y < GROUND) {
        b.vy += GRAVITY * dt;
        b.y = Math.min(GROUND, b.y + b.vy * dt);
      }
      if (b.x >= home) {
        b.x = home;
        b.state = "idle";
        b.timer = 0;
      }
      break;
  }
}

function hurt(cause, e) {
  const p = G.panda;
  if (p.inv > 0) return;
  if (G.shield) {
    G.shield = false;
    G.streak = 0;
    p.inv = 1.4;
    sfx("shieldbreak");
    G.shake = 0.5;
    if (e && (e.type === "spear" || e.type === "shot")) {
      const idx = G.ents.indexOf(e);
      if (idx >= 0) G.ents.splice(idx, 1);
    }
    if (e && e.type === "panther") {
      e.dead = true;
      e.deadT = 0;
    }
    for (let k = 0; k < 12; k++) spawnPart(p.x + p.w / 2, p.y - p.h / 2, "shield");
    updateHud();
    return;
  }
  G.lastCause = cause;
  p.vy = -600;
  p.onGround = false;
  G.shake = 1;
  G.hitFlash = 1;
  endRun(false);
}

function updateParticles(dt) {
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const q = G.parts[i];
    q.life -= dt;
    q.vy += 500 * dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    if (q.life <= 0) G.parts.splice(i, 1);
  }
  for (let i = G.scoreFloat.length - 1; i >= 0; i--) {
    const f = G.scoreFloat[i];
    f.life -= dt;
    f.y -= 60 * dt;
    if (f.life <= 0) G.scoreFloat.splice(i, 1);
  }
}

function pandaBox() {
  const p = G.panda;
  return { x: p.x + 16, y: p.y - p.h + 10, w: p.w - 32, h: p.h - 12 };
}
function entBox(e) {
  switch (e.type) {
    case "leaf":
    case "gold":
      return { x: e.x - e.w / 2 - 8, y: e.y - e.h / 2 - 8, w: e.w + 16, h: e.h + 16 };
    case "sprout":
      return { x: e.x - e.w / 2 - 6, y: e.y - e.h - 6, w: e.w + 12, h: e.h + 6 };
    case "spear":
      return e.hanging
        ? { x: e.x + 5, y: 0, w: e.w - 10, h: GROUND - 150 }
        : { x: e.x + 7, y: GROUND - e.h + 22, w: e.w - 14, h: e.h - 22 };
    case "shot":
      return { x: e.x + 12, y: e.y - 7, w: e.w - 24, h: 14 };
    case "panther":
      return { x: e.x + 14, y: e.y - e.h + 6, w: e.w - 28, h: e.h - 6 };
  }
  return { x: e.x, y: e.y, w: 0, h: 0 };
}
function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ── drawing ───────────────────────────────────────────────────────────────

function hash(n) {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function drawBamboo(x, baseY, height, width, color, nodeColor, leafColor, sway) {
  ctx.save();
  ctx.translate(x, baseY);
  ctx.rotate(sway);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-width / 2, -height, width, height, width / 2);
  ctx.fill();
  ctx.strokeStyle = nodeColor;
  ctx.lineWidth = Math.max(1.5, width * 0.16);
  const seg = 48 + width * 2;
  for (let y = -seg; y > -height; y -= seg) {
    ctx.beginPath();
    ctx.moveTo(-width / 2, y);
    ctx.lineTo(width / 2, y);
    ctx.stroke();
  }
  ctx.fillStyle = leafColor;
  for (let y = -height * 0.3; y > -height + 30; y -= seg * 1.5) {
    const dir = ((y / seg) | 0) % 2 === 0 ? 1 : -1;
    ctx.save();
    ctx.translate((dir * width) / 2, y);
    ctx.rotate(dir * -0.5);
    ctx.beginPath();
    ctx.ellipse(dir * 22, 0, 26, 7, 0, 0, 6.28);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawBackground() {
  const lv = L();
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, lv.sky[0]);
  sky.addColorStop(0.55, lv.sky[1]);
  sky.addColorStop(1, lv.sky[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  if (lv.stars) {
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < lv.stars; i++) {
      const s = G.stars[i];
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(G.t * 2 + s.p);
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * GROUND, s.r, 0, 6.28);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  const sun = lv.sun;
  ctx.save();
  ctx.shadowColor = sun.c;
  ctx.shadowBlur = 50;
  ctx.fillStyle = sun.c;
  ctx.beginPath();
  ctx.arc(sun.x * W, sun.y * GROUND, sun.r, 0, 6.28);
  ctx.fill();
  ctx.restore();
  if (G.level === 2) {
    ctx.fillStyle = lv.sky[0];
    ctx.beginPath();
    ctx.arc(sun.x * W + 16, sun.y * GROUND - 10, sun.r * 0.82, 0, 6.28);
    ctx.fill();
  }

  ctx.fillStyle = lv.far;
  ctx.beginPath();
  ctx.moveTo(0, GROUND);
  const off1 = G.dist * 0.12;
  for (let x = 0; x <= W; x += 20) {
    const y = GROUND - 120 - Math.sin((x + off1) * 0.006) * 40 - Math.sin((x + off1) * 0.017) * 22;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, GROUND);
  ctx.fill();

  const off2 = G.dist * 0.28;
  const sp2 = 62;
  const start2 = Math.floor(off2 / sp2);
  for (let i = start2 - 1; i < start2 + W / sp2 + 3; i++) {
    const r = hash(i);
    const x = i * sp2 - off2 + r * 30;
    drawBamboo(x, GROUND - 6, 220 + r * 160, 9 + r * 5, lv.mid, lv.far, lv.mid, Math.sin(G.t * 0.7 + i) * 0.01);
  }
  const off3 = G.dist * 0.55;
  const sp3 = 150;
  const start3 = Math.floor(off3 / sp3);
  for (let i = start3 - 1; i < start3 + W / sp3 + 3; i++) {
    const r = hash(i * 7.3);
    const x = i * sp3 - off3 + r * 70;
    drawBamboo(x, GROUND + 4, 300 + r * 230, 16 + r * 8, lv.near, lv.groundDark, lv.near, Math.sin(G.t * 0.9 + i * 2) * 0.012);
  }

  ctx.fillStyle = lv.ground;
  ctx.fillRect(0, GROUND - 4, W, H - GROUND + 4);
  ctx.fillStyle = lv.groundDark;
  ctx.fillRect(0, GROUND + 26, W, H - GROUND);
  const off4 = G.dist % 80;
  ctx.fillStyle = lv.groundDark;
  for (let x = -off4; x < W; x += 80) {
    ctx.beginPath();
    ctx.ellipse(x + 20, GROUND + 14, 22, 5, 0, 0, 6.28);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  for (let x = -off4 - 40; x < W; x += 80) ctx.fillRect(x, GROUND - 4, 26, 4);

  if (lv.fog > 0) {
    const fog = ctx.createLinearGradient(0, GROUND - 260, 0, GROUND + 20);
    fog.addColorStop(0, `rgba(${lv.fogColor},0)`);
    fog.addColorStop(1, `rgba(${lv.fogColor},${lv.fog})`);
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, W, H);
  }
  if (lv.fireflies) {
    for (let i = 0; i < lv.fireflies; i++) {
      const f = G.fireflies[i];
      const x = ((((f.x - G.dist * 0.4 * f.s) % (W + 40)) + W + 40) % (W + 40)) - 20;
      const y = f.y + Math.sin(G.t * 1.5 * f.s + f.p) * 14;
      const a = 0.35 + 0.65 * Math.abs(Math.sin(G.t * 2.2 + f.p));
      ctx.fillStyle = `rgba(255,240,120,${a})`;
      ctx.shadowColor = "#ffe66b";
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, 6.28);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
}

function drawImg(img, x, y, w, h) {
  if (img && img.complete && img.naturalWidth) ctx.drawImage(img, x, y, w, h);
}

function drawEntities() {
  for (const e of G.ents) {
    switch (e.type) {
      case "leaf":
      case "gold": {
        const bob = Math.sin(G.t * 4 + e.r) * 4;
        ctx.save();
        ctx.translate(e.x, e.y + bob);
        ctx.rotate(Math.sin(e.r) * 0.35);
        if (e.type === "gold") {
          ctx.shadowColor = "#ffd54a";
          ctx.shadowBlur = 18;
        }
        drawImg(IMG[e.type === "gold" ? "leaf_gold" : "leaf"], -e.w / 2, -e.h / 2, e.w, e.h);
        ctx.restore();
        break;
      }
      case "sprout": {
        const bob = Math.sin(G.t * 5) * 3;
        ctx.save();
        ctx.shadowColor = "#ffffff";
        ctx.shadowBlur = 14;
        drawImg(IMG.sprout, e.x - e.w / 2, e.y - e.h + bob, e.w, e.h);
        ctx.restore();
        break;
      }
      case "spear":
        if (e.hanging) {
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.fillRect(e.x + e.w / 2 - 3, 0, 6, GROUND - 150 - e.h + 6);
          ctx.save();
          ctx.translate(e.x + e.w / 2, GROUND - 150);
          ctx.scale(1, -1);
          drawImg(IMG.spear, -e.w / 2, 0, e.w, e.h);
          ctx.restore();
        } else {
          drawImg(IMG.spear, e.x, GROUND - e.h + 4, e.w, e.h);
        }
        break;
      case "shot": {
        ctx.save();
        ctx.translate(e.x + e.w / 2, e.y);
        ctx.rotate(Math.PI / 2);
        drawImg(IMG.spear, -e.h / 2, -e.w / 2, e.h, e.w);
        ctx.restore();
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(e.x + e.w, e.y);
        ctx.lineTo(e.x + e.w + 40, e.y);
        ctx.stroke();
        break;
      }
      case "panther": {
        ctx.save();
        const bob = e.dead ? 0 : Math.abs(Math.sin(e.anim)) * 6;
        ctx.translate(e.x + e.w / 2, e.y - bob);
        if (e.dead) {
          ctx.globalAlpha = Math.max(0, 1 - e.deadT * 1.3);
          ctx.translate(0, e.deadT * 260);
          ctx.scale(1, -1);
          ctx.translate(0, -e.h);
        }
        ctx.rotate(e.dead ? e.deadT * 4 : Math.sin(e.anim) * 0.05);
        drawImg(IMG.panther, -e.w / 2, -e.h, e.w, e.h);
        ctx.restore();
        break;
      }
    }
  }
}

function drawPanda() {
  const p = G.panda;
  if (p.inv > 0 && Math.floor(G.t * 18) % 2 === 0 && G.mode !== "over") return;
  const running = p.onGround && G.mode !== "over";
  const bob = running ? Math.abs(Math.sin(G.t * 16)) * 6 : 0;
  ctx.save();
  ctx.translate(p.x + p.w / 2, p.y - bob);
  const sq = p.squash;
  ctx.scale(1 - sq, 1 + sq);
  ctx.rotate(running ? Math.sin(G.t * 16) * 0.05 : G.mode === "over" ? G.modeT * 6 : Math.max(-0.25, Math.min(0.3, p.vy / 2400)));
  if (G.boost > 0) {
    ctx.shadowColor = "#fff5a0";
    ctx.shadowBlur = 22;
  }
  const img = running ? IMG.panda_run : IMG.panda_jump;
  const w = running ? p.w : p.w * 0.86;
  drawImg(img, -w / 2, -p.h, w, p.h);
  ctx.restore();
  if (G.shield) {
    ctx.save();
    ctx.translate(p.x + p.w / 2, p.y - p.h / 2 - bob);
    ctx.strokeStyle = `rgba(123,224,255,${0.6 + 0.3 * Math.sin(G.t * 8)})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(0, 0, p.w * 0.75, p.h * 0.66, 0, 0, 6.28);
    ctx.stroke();
    ctx.fillStyle = "rgba(123,224,255,0.12)";
    ctx.fill();
    ctx.restore();
  }
  if (G.boost > 0) {
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const y = p.y - p.h + 20 + i * 22 + Math.sin(G.t * 30 + i) * 3;
      ctx.beginPath();
      ctx.moveTo(p.x - 20 - i * 6, y);
      ctx.lineTo(p.x - 60 - i * 10, y);
      ctx.stroke();
    }
  }
}

function drawBoss() {
  const b = G.boss;
  if (!b) return;
  ctx.save();
  const bob = b.state === "charge" ? Math.abs(Math.sin(b.anim * 1.6)) * 8 : Math.sin(b.anim) * 3;
  ctx.translate(b.x + b.w / 2, b.y - bob);
  if (b.state === "dead") {
    ctx.rotate(b.anim * 0.4);
    ctx.scale(1, -1);
    ctx.translate(0, -b.h);
  }
  if (b.state === "roar") {
    const s = 1 + Math.sin(b.timer * 30) * 0.03;
    ctx.scale(s, 1 / s);
  }
  if (b.flash > 0) ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(b.flash * 40));
  drawImg(IMG.lion, -b.w / 2, -b.h, b.w, b.h);
  ctx.restore();
  if (b.state !== "dead") {
    const bw = 150;
    const x = b.x + b.w / 2 - bw / 2;
    const y = b.y - b.h - 26;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.roundRect(x - 3, y - 3, bw + 6, 16, 8);
    ctx.fill();
    ctx.fillStyle = "#ff5c5c";
    ctx.beginPath();
    ctx.roundRect(x, y, (bw * b.hp) / b.maxHp, 10, 5);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "700 14px Fredoka, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("LÖWE", b.x + b.w / 2, y - 8);
  }
}

function drawParticles() {
  for (const q of G.parts) {
    ctx.globalAlpha = Math.max(0, Math.min(1, q.life * 2));
    ctx.fillStyle =
      q.kind === "dust" ? "rgba(255,255,255,0.8)" : q.kind === "leaf" ? "#8be26a" : q.kind === "gold" ? "#ffd54a" : q.kind === "shield" ? "#7be0ff" : "#ffffff";
    ctx.beginPath();
    if (q.kind === "star") {
      ctx.moveTo(q.x, q.y - q.r);
      ctx.lineTo(q.x + q.r * 0.4, q.y);
      ctx.lineTo(q.x, q.y + q.r);
      ctx.lineTo(q.x - q.r * 0.4, q.y);
      ctx.closePath();
    } else ctx.arc(q.x, q.y, q.r, 0, 6.28);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.font = "700 22px Fredoka, system-ui, sans-serif";
  ctx.textAlign = "center";
  for (const f of G.scoreFloat) {
    ctx.globalAlpha = Math.min(1, f.life * 2);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillText(f.text, f.x + 2, f.y + 2);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

function drawProgress() {
  if (G.mode !== "playing") return;
  const lv = L();
  const w = Math.min(320, W * 0.4);
  const x = W / 2 - w / 2;
  const y = H - 22;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, 8, 4);
  ctx.fill();
  ctx.fillStyle = "#ffd54a";
  ctx.beginPath();
  ctx.roundRect(x, y, w * Math.min(1, G.dist / lv.dist), 8, 4);
  ctx.fill();
  ctx.font = "16px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("🦁", x + w + 8, y + 8);
}

function draw() {
  if (!G) return;
  const dpr = canvas.width / W;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.save();
  if (G.shake > 0) {
    const s = G.shake * 8;
    ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }
  drawBackground();
  drawEntities();
  drawBoss();
  drawPanda();
  drawParticles();
  ctx.restore();
  drawProgress();
  if (G.hitFlash > 0) {
    ctx.fillStyle = `rgba(255,80,80,${Math.min(0.5, G.hitFlash * 0.5)})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// ── loop / resize ─────────────────────────────────────────────────────────

function resize() {
  const vw = window.innerWidth || document.documentElement.clientWidth || 960;
  const vh = window.innerHeight || document.documentElement.clientHeight || 540;
  const aspect = vw > 0 && vh > 0 ? vw / vh : 16 / 9;
  W = Math.round(Math.max(420, Math.min(1280, aspect * H)));
  const scale = Math.min(vw / W, vh / H);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${Math.round(W * scale)}px`;
  canvas.style.height = `${Math.round(H * scale)}px`;
  if (G) G.panda.x = Math.round(W * 0.2);
}
window.addEventListener("resize", resize);

function frame(ts) {
  const dt = Math.min(1 / 30, (ts - lastTime) / 1000 || 0);
  lastTime = ts;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

resize();
newGame();
updateHud();
loadImages().then(() => requestAnimationFrame(frame));
connect();
