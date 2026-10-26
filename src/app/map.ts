import { TICKS_PER_SECOND } from "../parser/replay.ts";
import { ageAt, type Analysis, type OrderKind, type Placement, type PlayerInfo } from "./analysis.ts";
import { AGE_ICONS, AGES, formatTime } from "./data.ts";
import { h, icon } from "./dom.ts";

const SIZE = 720;
const FEED_ROW = 24;
const FEED_PX_PER_SEC = 8;
// Repeats of the same item by the same player within this window share a row.
const FEED_MERGE_SEC = 20;

interface FeedEntry {
  player: PlayerInfo;
  pbgid: number;
  time: number;
  y: number;
  el: HTMLElement;
  count: HTMLElement;
  parts: { time: number; count: number }[];
}

const marker = (shape: string) => h("span", { class: `marker marker-${shape}` });

export function renderMap(a: Analysis): HTMLElement {
  const canvas = h("canvas", { class: "map", width: SIZE, height: SIZE });
  const tooltip = h("div", { class: "tooltip", hidden: true });
  const slider = h("input", { type: "range", min: 0, max: Math.ceil(a.durationSeconds), step: 1, value: 0, class: "grow" });
  const clock = h("span", { class: "clock" });
  const play = h("button", { class: "play" }, "Play");
  const speed = h("select", null, [4, 8, 16, 32, 64].map((s) => h("option", { value: s, selected: s === 16 }, `${s}×`)));
  const trail = h("select", null, [15, 30, 60, 120].map((s) => h("option", { value: s, selected: s === 30 }, `${s}s`)));
  const layers = {
    buildings: h("input", { type: "checkbox", checked: true }),
    move: h("input", { type: "checkbox", checked: true }),
    attack: h("input", { type: "checkbox", checked: true }),
    rally: h("input", { type: "checkbox", checked: true }),
    other: h("input", { type: "checkbox" }),
  };
  const visible = new Map(a.players.map((p) => [p.playerId, true]));

  const dpr = window.devicePixelRatio || 1;
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  canvas.style.width = `${SIZE}px`;
  canvas.style.height = `${SIZE}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const half = a.mapHalfSize;
  const px = (x: number) => ((x + half) / (2 * half)) * SIZE;
  const py = (z: number) => ((half - z) / (2 * half)) * SIZE;
  const shown = (p: { player?: { playerId: number } }) => !p.player || visible.get(p.player.playerId) !== false;

  // Build order feed: one lane per team, rows placed at their game time so quiet
  // periods stay empty, scrolling with playback.
  const feedEntries: FeedEntry[] = [];
  const lanes = [...new Set(a.players.map((p) => p.team))].sort((x, y) => x - y).map((team) => {
    const members = a.players.filter((p) => p.team === team);
    const items = members
      .flatMap((p) => (a.buildOrder.get(p.playerId) ?? []).map((it) => ({ it, p })))
      .sort((x, y) => x.it.time - y.it.time);
    const lane = h("div", { class: "feed-lane" });
    const recent = new Map<string, FeedEntry>();
    let bottom = 0;
    for (const { it, p } of items) {
      const key = `${p.playerId}:${it.pbgid}`;
      const prev = recent.get(key);
      if (prev && it.time - prev.time < FEED_MERGE_SEC) {
        prev.parts.push({ time: it.time, count: it.count });
        continue;
      }
      const y = Math.max(it.time * FEED_PX_PER_SEC, bottom);
      bottom = y + FEED_ROW;
      const count = h("span", { class: "count" });
      const el = h("div", {
        class: `feed-row cat-${it.category}${a.data.isLandmark(it.pbgid) ? " landmark" : ""}`,
        style: `top:${y}px;border-left-color:${p.color}`,
        title: `${p.name}: ${a.data.name(it.pbgid)}`,
        hidden: true,
      },
      h("span", { class: "time" }, formatTime(it.time)),
      icon(a.data.get(it.pbgid)?.icon, a.data.name(it.pbgid)),
      h("span", { class: "name" }, a.data.name(it.pbgid), count));
      lane.append(el);
      const entry: FeedEntry = { player: p, pbgid: it.pbgid, time: it.time, y, el, count, parts: [{ time: it.time, count: it.count }] };
      recent.set(key, entry);
      feedEntries.push(entry);
    }
    const header = h("div", { class: "feed-head" }, members.map((p) =>
      h("span", null, h("span", { class: "swatch", style: `background:${p.color}` }), " ", p.name)));
    return { header, lane, bottom };
  });
  const feedHeight = Math.max(a.durationSeconds * FEED_PX_PER_SEC, ...lanes.map((l) => l.bottom)) + FEED_ROW;
  const laneColumns = `grid-template-columns:repeat(${lanes.length}, minmax(0, 1fr))`;
  const feedScroll = h("div", { class: "feed" },
    h("div", { class: "feed-lanes", style: `height:${feedHeight}px;${laneColumns}` }, lanes.map((l) => l.lane)));
  let feedState = "";
  let revealedBottom = 0;
  const updateFeed = (t: number) => {
    let revealed = 0;
    for (const e of feedEntries) for (const part of e.parts) if (part.time <= t) revealed++;
    const state = `${revealed}|${[...visible.values()].join()}`;
    if (state !== feedState) {
      feedState = state;
      revealedBottom = 0;
      for (const e of feedEntries) {
        const parts = e.parts.filter((part) => part.time <= t);
        const show = parts.length > 0 && visible.get(e.player.playerId) !== false;
        e.el.hidden = !show;
        if (!show) continue;
        const n = parts.reduce((sum, part) => sum + part.count, 0);
        e.count.textContent = n > 1 ? ` ×${n}` : "";
        revealedBottom = Math.max(revealedBottom, e.y + FEED_ROW);
      }
    }
    // Keep the current moment (or the newest row, if rows were pushed down) at the bottom.
    const target = Math.max(t * FEED_PX_PER_SEC, revealedBottom);
    feedScroll.scrollTop = Math.max(0, target - feedScroll.clientHeight);
  };

  // Per-player stats at the playback time.
  const stats = a.players.map((p) => {
    const img = h("img", { class: "age-icon", alt: "" });
    const age = h("div", { class: "age-name" });
    const detail = h("div", { class: "age-detail" });
    const el = h("div", { class: "player-stat", style: `border-left-color:${p.color}` },
      img,
      h("div", null,
        h("div", { class: "player-stat-name" }, p.name, h("span", { class: "muted" }, ` · ${p.civName}`)),
        age, detail));
    return { p, el, img, age, detail, key: "" };
  });
  const updateStats = (t: number) => {
    for (const s of stats) {
      const now = ageAt(a.ageUps.get(s.p.playerId) ?? [], t);
      const hidden = visible.get(s.p.playerId) === false;
      const key = `${now.age}|${now.pending?.pbgid ?? ""}|${hidden}`;
      if (key === s.key) continue;
      s.key = key;
      s.el.classList.toggle("dim", hidden);
      s.img.src = AGE_ICONS[now.age];
      s.img.alt = AGES[now.age];
      s.age.textContent = AGES[now.age];
      s.detail.textContent = now.pending
        ? `Advancing to ${AGES[now.pending.age]} (${a.data.name(now.pending.pbgid)}), done ~${formatTime(now.pending.done)}`
        : now.age > 1 ? `Since ~${formatTime(now.since)}` : "";
    }
  };

  // Chat messages revealed as playback reaches them.
  const chatEmpty = h("li", { class: "muted" }, "No messages yet.");
  const chatList = h("ul", { class: "chat-feed" }, chatEmpty);
  const chat = a.replay.summary.chat.map((c) => {
    const time = (c.tick ?? 0) / TICKS_PER_SECOND;
    const color = a.players.find((p) => p.name === c.sender)?.color ?? "var(--ink-2)";
    const el = h("li", { hidden: true },
      h("span", { class: "time" }, formatTime(time)),
      h("span", null, h("strong", { style: `color:${color}` }, c.sender), ": ", c.message));
    chatList.append(el);
    return { time, el };
  });
  let chatShown = -1;
  const updateChat = (t: number) => {
    const n = chat.filter((c) => c.time <= t).length;
    if (n === chatShown) return;
    chatShown = n;
    chat.forEach((c, i) => { c.el.hidden = i >= n; });
    chatEmpty.hidden = n > 0;
    chatList.scrollTop = chatList.scrollHeight;
  };

  let shownBuildings: Placement[] = [];
  // Playback time in seconds; the slider only has whole-second resolution.
  let time = 0;

  const draw = () => {
    const t = time;
    clock.textContent = `${formatTime(t)} / ${formatTime(a.durationSeconds)}`;
    updateFeed(t);
    updateStats(t);
    updateChat(t);
    ctx.fillStyle = "#1d2a1f";
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let g = -half; g <= half; g += 32) {
      ctx.beginPath(); ctx.moveTo(px(g), 0); ctx.lineTo(px(g), SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, py(g)); ctx.lineTo(SIZE, py(g)); ctx.stroke();
    }

    const trailSec = Number(trail.value);
    for (const o of a.orders) {
      if (o.time > t || o.time < t - trailSec || !shown(o) || !layers[o.kind].checked) continue;
      const age = (t - o.time) / trailSec;
      ctx.globalAlpha = 0.15 + 0.75 * (1 - age);
      drawOrder(o.kind, px(o.x), py(o.z), o.player?.color ?? "#ccc", o.units);
    }
    ctx.globalAlpha = 1;

    shownBuildings = layers.buildings.checked
      ? a.placements.filter((b) => b.time <= t && shown(b))
      : [];
    for (const b of shownBuildings) if (!b.landmark) drawBuilding(b);
    for (const b of shownBuildings) if (b.landmark) drawBuilding(b);
  };

  // Building icons, loaded once per pbgid; the map redraws as they arrive.
  const icons = new Map<number, HTMLImageElement | null>();
  const iconFor = (pbgid: number): HTMLImageElement | null => {
    if (!icons.has(pbgid)) {
      const src = a.data.get(pbgid)?.icon;
      if (!src) {
        icons.set(pbgid, null);
      } else {
        const img = new Image();
        img.onload = () => draw();
        img.onerror = () => { icons.set(pbgid, null); draw(); };
        img.src = src;
        icons.set(pbgid, img);
      }
    }
    const img = icons.get(pbgid) ?? null;
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  };

  const buildingSize = (b: Placement) => (b.landmark ? 26 : 16);

  const drawBuilding = (b: Placement) => {
    const x = px(b.x);
    const y = py(b.z);
    const color = b.player?.color ?? "#ccc";
    const img = iconFor(b.pbgid);
    if (!img) {
      const s = b.landmark ? 12 : 6;
      ctx.fillStyle = color;
      ctx.strokeStyle = b.landmark ? "#fff" : "rgba(0,0,0,0.6)";
      ctx.lineWidth = b.landmark ? 2 : 1;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      ctx.strokeRect(x - s / 2, y - s / 2, s, s);
      return;
    }
    // Player-coloured frame around the icon so ownership stays visible.
    const s = buildingSize(b);
    const frame = b.landmark ? 3 : 2;
    ctx.fillStyle = color;
    ctx.fillRect(x - s / 2 - frame, y - s / 2 - frame, s + 2 * frame, s + 2 * frame);
    ctx.fillStyle = "#0b0e12";
    ctx.fillRect(x - s / 2, y - s / 2, s, s);
    ctx.drawImage(img, x - s / 2, y - s / 2, s, s);
  };

  const drawOrder = (kind: OrderKind, x: number, y: number, color: string, units: number) => {
    const r = 3 + Math.min(8, Math.sqrt(units) * 1.5);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (kind === "attack") {
      ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
      ctx.stroke();
    } else if (kind === "rally") {
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
      ctx.stroke();
    } else if (kind === "move") {
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  let playing = false;
  let last = 0;
  const tick = (now: number) => {
    if (!playing) return;
    if (!canvas.isConnected) { setPlaying(false); return; }
    const dt = (now - last) / 1000;
    last = now;
    time = Math.min(a.durationSeconds, time + dt * Number(speed.value));
    slider.value = String(time);
    draw();
    if (time >= a.durationSeconds) setPlaying(false);
    else requestAnimationFrame(tick);
  };
  const setPlaying = (on: boolean) => {
    playing = on;
    play.textContent = on ? "Pause" : "Play";
    if (on) {
      if (time >= a.durationSeconds) time = 0;
      last = performance.now();
      requestAnimationFrame(tick);
    }
  };
  play.addEventListener("click", () => setPlaying(!playing));
  slider.addEventListener("input", () => { time = Number(slider.value); draw(); });
  for (const el of [trail, ...Object.values(layers)]) el.addEventListener("input", draw);

  canvas.addEventListener("mousemove", (ev) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    let best: Placement | undefined;
    let bestD = Infinity;
    for (const b of shownBuildings) {
      const d = Math.hypot(px(b.x) - mx, py(b.z) - my);
      if (d < bestD && d <= buildingSize(b) / 2 + 3) { bestD = d; best = b; }
    }
    if (!best) { tooltip.hidden = true; return; }
    tooltip.hidden = false;
    tooltip.textContent = `${a.data.name(best.pbgid)} — ${best.player?.name ?? "?"}, placed ${formatTime(best.time)}`;
    tooltip.style.left = `${mx + 14}px`;
    tooltip.style.top = `${my + 14}px`;
  });
  canvas.addEventListener("mouseleave", () => { tooltip.hidden = true; });

  const legend = h("div", { class: "legend" },
    a.players.map((p) => {
      const cb = h("input", { type: "checkbox", checked: true });
      cb.addEventListener("input", () => { visible.set(p.playerId, cb.checked); draw(); });
      return h("label", null, cb, " ", h("span", { class: "swatch", style: `background:${p.color}` }), " ", p.name);
    }),
    h("span", { class: "sep" }),
    h("label", null, layers.buildings, " Buildings"),
    h("label", null, layers.move, " ", marker("circle"), " Move orders"),
    h("label", null, layers.attack, " ", marker("cross"), " Attack-move / patrol"),
    h("label", null, layers.rally, " ", marker("diamond"), " Rally points"),
    h("label", null, layers.other, " ", marker("dot"), " Other targeted orders"),
    h("label", null, "Order trail ", trail),
  );

  draw();
  return h("div", null,
    h("div", { class: "toolbar" }, play, speed, slider, clock),
    legend,
    h("div", { class: "player-stats" }, stats.map((s) => s.el)),
    h("div", { class: "map-layout" },
      h("div", { class: "map-wrap" }, canvas, tooltip),
      h("div", { class: "feed-wrap" },
        h("h2", null, "Build order"),
        h("div", { class: "feed-heads", style: laneColumns }, lanes.map((l) => l.header)),
        feedScroll,
        h("h2", { class: "chat-head" }, "Chat"),
        chatList)),
    h("p", { class: "note" }, "The replay doesn't record unit positions or destroyed buildings. Build order shows when items were ordered. Age-up times are estimates."),
  );
}
