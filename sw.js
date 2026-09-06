// Service Worker: caches the whole game so it starts offline once installed.
const CACHE = "bao-v1";
const FILES = [
  "./",
  "index.html",
  "client.js",
  "manifest.webmanifest",
  "assets/cover.jpg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-maskable.png",
  "assets/icon.png",
  "assets/leaf.png",
  "assets/leaf_gold.png",
  "assets/lion.png",
  "assets/panda_jump.png",
  "assets/panda_run.png",
  "assets/panther.png",
  "assets/spear.png",
  "assets/sprout.png",
  "audio/music_boss.m4a",
  "audio/music_l1.m4a",
  "audio/music_l2.m4a",
  "audio/music_l3.m4a",
  "audio/music_title.m4a",
  "audio/sfx_boost.mp3",
  "audio/sfx_bosshit.mp3",
  "audio/sfx_bosswin.mp3",
  "audio/sfx_gameover.mp3",
  "audio/sfx_gold.mp3",
  "audio/sfx_jump.mp3",
  "audio/sfx_land.mp3",
  "audio/sfx_leaf.mp3",
  "audio/sfx_levelup.mp3",
  "audio/sfx_panther.mp3",
  "audio/sfx_roar.mp3",
  "audio/sfx_shield.mp3",
  "audio/sfx_shieldbreak.mp3",
  "audio/sfx_squash.mp3"
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok && new URL(e.request.url).origin === location.origin) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
    }
    return res;
  })));
});
