// Player commands found inside game-tick records (port of AoE4.Replay.Command).
//
// A command is a 24 byte header followed by a unit selection and a list of
// tag/length/value arguments terminated by the end of the command or 0xff.

import { Reader, ParseError, attempt, runExact, toHex } from "./binary.ts";
import type { Arg, Command, Entity, Target, Vec3 } from "./types.ts";

const NAMES: Record<number, string> = {
  3: "QueueUnit",
  12: "SetRallyPoint",
  16: "Research",
  62: "Move",
  63: "Cancel",
  65: "Construct",
  71: "AttackMove",
  72: "UnitAbility",
  73: "SeekShelter",
  109: "UnitStance",
  116: "Patrol",
  123: "PlaceBuilding",
  143: "Surrender",
  146: "PreCommand",
  148: "PostCommand",
  152: "Periodic152",
  153: "Periodic153",
  154: "Periodic154",
};

export function commandName(t: number): string {
  return NAMES[t] ?? `Unknown${t}`;
}

export function readCommand(r: Reader): Command {
  const size = r.u16();
  if (size < 24) throw new ParseError(`command too small: ${size}`);
  const type = r.u8();
  const flags = r.u8();
  const sequence = r.u32();
  const unknown = toHex(r.bytes(12));
  const playerId = r.u32();
  const body = r.bytes(size - 24);
  const cmd: Command = { type, name: commandName(type), flags, sequence, playerId, unknown };
  const payload = attempt(() => runExact(body, (b) => ({ selection: readSelection(b), args: readArgs(b) })));
  if (payload) {
    cmd.selection = payload.selection;
    cmd.args = payload.args;
  } else {
    cmd.raw = toHex(body);
  }
  return cmd;
}

function readSelection(r: Reader): Entity[] {
  const marker = r.u8();
  const packed = (n: number): Entity[] => {
    const out: Entity[] = [];
    for (let i = 0; i < n; i++) {
      const w = r.u32();
      out.push({ kind: w >>> 24, id: w & 0xffffff });
    }
    return out;
  };
  if (marker >= 0x80) {
    if (marker !== 0x80) throw new ParseError("unsupported selection marker");
    return packed(r.u8());
  }
  if (marker >= 0x40) return packed(marker - 0x40);
  // Single entity: kind byte followed by a big-endian 24-bit id.
  const b = r.bytes(3);
  return [{ kind: marker, id: (b[0] << 16) | (b[1] << 8) | b[2] }];
}

function readArgs(r: Reader): Arg[] {
  const out: Arg[] = [];
  while (!r.isEmpty()) {
    const tag = r.u8();
    if (tag === 0xff) {
      out.push({ arg: "end", tag });
      continue;
    }
    const l0 = r.u8();
    const len = l0 & 0x80 ? ((l0 & 0x7f) << 8) | r.u8() : l0;
    out.push(decodeArg(tag, r.bytes(len)));
  }
  return out;
}

const vec3 = (r: Reader): Vec3 => ({ x: r.f32(), y: r.f32(), z: r.f32() });

function readTarget(r: Reader): Target {
  const kind = r.u8();
  switch (kind) {
    case 2: return { position: vec3(r) };
    case 3:
    case 4: return { entity: r.u32(), entityKind: kind };
    case 5: return { rotation: [r.f32(), r.f32(), r.f32(), r.f32()] };
    default: throw new ParseError("unknown target kind");
  }
}

function readTargets(r: Reader): Target[] {
  const out: Target[] = [];
  while (!r.isEmpty() && [2, 3, 4, 5].includes(r.peekU8())) out.push(readTarget(r));
  return out;
}

const placement = (k: number) => (r: Reader): Arg => {
  const count = r.u8();
  const pbgid = r.u32();
  const positions = [vec3(r), vec3(r), vec3(r)];
  const unknown1 = r.u32();
  const unknown2 = toHex(r.bytes(k));
  const n = r.u8();
  const builders: number[] = [];
  for (let i = 0; i < n; i++) builders.push(r.u32());
  return { arg: "placement", tag: 0, count, pbgid, positions, unknown1, unknown2, builders };
};

const ability = (r: Reader): Arg =>
  ({ arg: "ability", tag: 0, count: r.u8(), pbgid: r.u32(), unknown: r.u8() });

const targetedAbility = (r: Reader): Arg => ({
  arg: "targetedAbility", tag: 0, count: r.u8(), pbgid: r.u32(),
  unknown1: r.u8(), unknown2: r.u32(), target: readTarget(r),
});

// Tag numbers differ between game versions (abilities moved from 35/36 to
// 36/37, placement from 26 to 27), so arguments are matched by tag and layout.
function parsersFor(tag: number): ((r: Reader) => Arg)[] {
  switch (tag) {
    case 1: return [(r) => ({ arg: "target", tag, target: readTarget(r) })];
    case 5: return [(r) => ({ arg: "count", tag, value: r.u32() })];
    case 6: return [(r) => ({ arg: "offsetTarget", tag, unknown: r.u32(), target: readTarget(r) })];
    case 20: return [(r) => ({ arg: "item", tag, count: r.u8(), pbgid: r.u32() })];
    case 21: return [(r) => ({
      arg: "produce", tag, count: r.u8(), pbgid: r.u32(), playerId: r.u32(), unknown: toHex(r.rest()),
    })];
    case 23: return [(r) => ({ arg: "resign", tag, kind: r.u32(), data: r.ascii() })];
    case 2: case 3: case 29: case 30:
      return [(r) => ({ arg: "targets", tag, targets: readTargets(r), unknown: toHex(r.rest()) })];
    case 26: case 27: return [placement(5), placement(3)];
    case 35: case 36: case 37: return [ability, targetedAbility];
    case 41: case 42: return [(r) => ({
      arg: "pointAbility", tag, count: r.u8(), pbgid: r.u32(), unknown: r.u8(), targets: readTargets(r),
    })];
    default: return [];
  }
}

function decodeArg(tag: number, body: Uint8Array): Arg {
  for (const p of parsersFor(tag)) {
    const a = attempt(() => runExact(body, p));
    if (a) return { ...a, tag };
  }
  return { tag, raw: toHex(body) };
}
