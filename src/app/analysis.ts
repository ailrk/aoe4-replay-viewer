// Derived views of a parsed replay shared by the UI tabs.

import type { Arg, Command, Replay, Target, Vec3 } from "../parser/types.ts";
import { TICKS_PER_SECOND } from "../parser/replay.ts";
import { type GameData, civName } from "./data.ts";

export const PLAYER_COLORS = ["#2c5fc7", "#c0352b", "#d4a417", "#3d8b37", "#25918a", "#7e4bb3", "#d9731c", "#c9558f"];

/** Commands that are bookkeeping rather than player actions. */
export const SYSTEM_TYPES = new Set([146, 148, 152, 153, 154]);

export interface PlayerInfo {
  playerId: number;
  name: string;
  civ: string;
  civName: string;
  team: number;
  profileId: number;
  isHuman: boolean;
  color: string;
  actions: number;
  apm: number;
}

export interface Event {
  tick: number;
  time: number;
  cmd: Command;
  player: PlayerInfo | undefined;
}

export interface Placement {
  time: number;
  player: PlayerInfo | undefined;
  pbgid: number;
  x: number;
  z: number;
  landmark: boolean;
}

export type OrderKind = "move" | "attack" | "rally" | "other";

export interface Order {
  time: number;
  player: PlayerInfo | undefined;
  kind: OrderKind;
  x: number;
  z: number;
  units: number;
}

export type BuildCategory = "unit" | "building" | "technology";

export interface BuildItem {
  time: number;
  pbgid: number;
  count: number;
  category: BuildCategory;
}

/** An age-up started by a landmark placement or an age-up research. */
export interface AgeUp {
  age: number;
  pbgid: number;
  start: number;
  /** Estimate: start plus the base build or research time. */
  done: number;
}

export interface Analysis {
  replay: Replay;
  data: GameData;
  players: PlayerInfo[];
  events: Event[];
  placements: Placement[];
  orders: Order[];
  durationSeconds: number;
  mapHalfSize: number;
  buildOrder: Map<number, BuildItem[]>;
  ageUps: Map<number, AgeUp[]>;
}

const isPosition = (t: Target): t is { position: Vec3 } => "position" in t;

function positionsOf(args: Arg[]): Vec3[] {
  const out: Vec3[] = [];
  for (const a of args) {
    if (a.arg === "target" || a.arg === "offsetTarget" || a.arg === "targetedAbility") {
      if (isPosition(a.target)) out.push(a.target.position);
    } else if (a.arg === "targets" || a.arg === "pointAbility") {
      for (const t of a.targets) if (isPosition(t)) out.push(t.position);
    }
  }
  return out;
}

function orderKind(type: number): OrderKind {
  if (type === 62) return "move";
  if (type === 71 || type === 116) return "attack";
  if (type === 12) return "rally";
  return "other";
}

export function analyze(replay: Replay, data: GameData): Analysis {
  // Raw team values are arbitrary (e.g. 0 and 7); number them 1, 2, ... instead.
  const teamIds = [...new Set(replay.summary.players.map((p) => p.team))].sort((x, y) => x - y);
  const players: PlayerInfo[] = replay.summary.players.map((p, i) => ({
    playerId: p.playerId,
    name: p.name,
    civ: p.civilization,
    civName: civName(p.civilization),
    team: teamIds.indexOf(p.team) + 1,
    profileId: p.profileId,
    isHuman: p.isHuman,
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    actions: 0,
    apm: 0,
  }));
  const byId = new Map(players.map((p) => [p.playerId, p]));

  const events: Event[] = [];
  const placements: Placement[] = [];
  const orders: Order[] = [];
  const buildOrder = new Map<number, BuildItem[]>(players.map((p) => [p.playerId, []]));
  let lastTick = 0;

  for (const rec of replay.records) {
    if (rec.record !== "tick") continue;
    lastTick = rec.tick;
    for (const block of rec.blocks) {
      for (const cmd of block.commands) {
        const player = byId.get(cmd.playerId);
        const time = rec.tick / TICKS_PER_SECOND;
        events.push({ tick: rec.tick, time, cmd, player });
        if (SYSTEM_TYPES.has(cmd.type) || !player) continue;
        player.actions++;
        const args = cmd.args ?? [];
        const build = buildOrder.get(cmd.playerId)!;
        for (const a of args) {
          if (a.arg === "placement") {
            const p = a.positions[0];
            const landmark = data.isLandmark(a.pbgid);
            placements.push({ time, player, pbgid: a.pbgid, x: p.x, z: p.z, landmark });
            build.push({ time, pbgid: a.pbgid, count: 1, category: "building" });
          } else if (a.arg === "produce" && (cmd.type === 3 || cmd.type === 16)) {
            const known = data.get(a.pbgid)?.category;
            const category: BuildCategory =
              known === "technology" || (known === undefined && cmd.type === 16) ? "technology"
                : known === "building" ? "building" : "unit";
            build.push({ time, pbgid: a.pbgid, count: a.count, category });
          }
        }
        for (const p of positionsOf(args)) {
          orders.push({ time, player, kind: orderKind(cmd.type), x: p.x, z: p.z, units: cmd.selection?.length ?? 0 });
        }
      }
    }
  }

  const durationSeconds = (replay.summary.durationTicks ?? lastTick) / TICKS_PER_SECOND;
  for (const p of players) p.apm = durationSeconds > 0 ? p.actions / (durationSeconds / 60) : 0;

  const sizeMatch = /map_size_(\d+)/.exec(replay.summary.map?.size ?? "");
  let half = sizeMatch ? Number(sizeMatch[1]) / 2 : 0;
  for (const p of [...placements, ...orders]) half = Math.max(half, Math.abs(p.x) + 4, Math.abs(p.z) + 4);

  return {
    replay, data, players, events, placements, orders, durationSeconds,
    mapHalfSize: half || 256,
    buildOrder,
    ageUps: new Map(players.map((p) => [p.playerId, ageUpsOf(buildOrder.get(p.playerId) ?? [], data)])),
  };
}

/**
 * The first landmark or age-up research of each tier advances the age. Completion is
 * estimated from the base build time, but capped by the first later order that needs
 * the new age (several builders finish a landmark much faster).
 */
function ageUpsOf(items: BuildItem[], data: GameData): AgeUp[] {
  const out: AgeUp[] = [];
  for (const it of items) {
    const age = data.ageUpTarget(it.pbgid);
    if (age === null || out.some((u) => u.age === age)) continue;
    let done = it.time + (data.get(it.pbgid)?.time ?? 0);
    const proof = items.find((o) => o.time > it.time && data.ageUpTarget(o.pbgid) === null && (data.get(o.pbgid)?.age ?? 0) >= age);
    if (proof) done = Math.min(done, proof.time);
    out.push({ age, pbgid: it.pbgid, start: it.time, done });
  }
  return out;
}

/** A player's age at time t, plus the age-up in progress, if any. */
export function ageAt(ups: AgeUp[], t: number): { age: number; since: number; pending: AgeUp | undefined } {
  let age = 1;
  let since = 0;
  let pending: AgeUp | undefined;
  for (const u of ups) {
    if (u.done <= t) {
      if (u.age > age) { age = u.age; since = u.done; }
    } else if (u.start <= t && (!pending || u.age > pending.age)) {
      pending = u;
    }
  }
  if (pending && pending.age <= age) pending = undefined;
  return { age, since, pending };
}

/** Collapse consecutive identical build items into one entry with a count. */
export function collapse(items: BuildItem[]): BuildItem[] {
  const out: BuildItem[] = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    if (prev && prev.pbgid === it.pbgid && prev.category === it.category) {
      out[out.length - 1] = { ...prev, count: prev.count + it.count };
    } else {
      out.push({ ...it });
    }
  }
  return out;
}

/** Short human-readable description of a command's arguments. */
export function describe(cmd: Command, data: GameData): string {
  if (cmd.raw !== undefined) return "";
  const parts: string[] = [];
  const pos = (v: Vec3) => `(${v.x.toFixed(0)}, ${v.z.toFixed(0)})`;
  const target = (t: Target) =>
    "position" in t ? pos(t.position) : "entity" in t ? `#${t.entity}` : "rotation";
  for (const a of cmd.args ?? []) {
    switch (a.arg) {
      case "produce": parts.push(`${data.name(a.pbgid)}${a.count > 1 ? ` ×${a.count}` : ""}`); break;
      case "placement": parts.push(`${data.name(a.pbgid)} at ${pos(a.positions[0])}`); break;
      case "target": case "offsetTarget": parts.push(`→ ${target(a.target)}`); break;
      case "targets": parts.push(`→ ${a.targets.filter(isPosition).map(target).join(" ")}`); break;
      case "ability": case "item": parts.push(data.name(a.pbgid)); break;
      case "targetedAbility": parts.push(`${data.name(a.pbgid)} → ${target(a.target)}`); break;
      case "pointAbility": parts.push(`${data.name(a.pbgid)} → ${a.targets.filter(isPosition).map(target).join(" ")}`); break;
      case "count": parts.push(`#${a.value}`); break;
      case "resign": parts.push("resign"); break;
      default: break;
    }
  }
  return parts.join(", ");
}
