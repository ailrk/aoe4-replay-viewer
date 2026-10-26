// Decoder for the FOLD:INFO / DATA:DATA chunk (port of AoE4.Replay.GameSetup).
//
// Player records have a fixed header followed by a tail whose layout varies,
// so records are split by locating the next valid player header. The last
// record ends at a block that starts with the u32 value 8 and sits 40 bytes
// (setup v58+) or 44 bytes (v56/57) before the option sections; that block
// holds the match id.

import { Reader, ParseError, attempt, latin1, le32At, runExact, runPrefix, scanStrings, toHex } from "./binary.ts";
import type { GameSetup, MapInfo, OptionSection, Player } from "./types.ts";

type PlayerHeader = Omit<Player, "attributes" | "unknown"> & { unknown: Omit<Player["unknown"], "tail"> };

function guard(ok: boolean): void {
  if (!ok) throw new ParseError("implausible player header");
}

function readPlayerHeader(r: Reader): PlayerHeader {
  const human = r.u8();
  guard(human <= 1);
  const nameLen = r.peekU32();
  guard(nameLen >= 1 && nameLen <= 64);
  const name = r.utf16();
  for (const c of name) guard(c >= " " && c !== "\uFFFD");
  const team = r.u32();
  guard(team < 64);
  const slot = r.u32();
  guard(slot < 64);
  const u1 = r.u8();
  const civLen = r.peekU32();
  guard(civLen >= 3 && civLen <= 40);
  const civilization = r.ascii();
  guard(/^[a-z0-9_]+$/.test(civilization));
  const u2: [number, number, number] = [r.u16(), r.u16(), r.u32()];
  const preset = r.ascii();
  const u3: number[] = [];
  for (let i = 0; i < 7; i++) u3.push(r.u32());
  const index = r.u32();
  const hostComputer = r.u32();
  const u4 = r.u32();
  const profileId = r.u32();
  const u5 = toHex(r.bytes(5));
  const platformId = r.utf16();
  return {
    isHuman: human !== 0, name, team, slot, playerId: slot + 1000, civilization, preset,
    index, hostComputer, profileId, platformId, unknown: { u1, u2, u3, u4, u5 },
  };
}

/** All u32-length-prefixed strings that look like JSON objects, in order. */
function jsonStrings(b: Uint8Array): string[] {
  const out: string[] = [];
  let i = 0;
  while (i + 6 <= b.length) {
    const len = le32At(b, i);
    if (len >= 2 && len <= 4096 && i + 4 + len <= b.length && b[i + 4] === 0x7b && b[i + 3 + len] === 0x7d) {
      out.push(latin1(b.subarray(i + 4, i + 4 + len)));
      i += 4 + len;
    } else {
      i += 1;
    }
  }
  return out;
}

function splitPlayers(n: number, buf: Uint8Array): Player[] {
  const players: Player[] = [];
  let bs = buf;
  for (let left = n; left > 0; left--) {
    const [h, afterHeader] = runPrefix(bs, readPlayerHeader);
    let tailLen = afterHeader.length;
    if (left > 1) {
      for (let i = 0; i < afterHeader.length; i++) {
        if (attempt(() => runPrefix(afterHeader.subarray(i), readPlayerHeader))) {
          tailLen = i;
          break;
        }
      }
    }
    const tail = afterHeader.subarray(0, tailLen);
    players.push({ ...h, attributes: jsonStrings(tail), unknown: { ...h.unknown, tail: toHex(tail) } });
    bs = afterHeader.subarray(tailLen);
  }
  if (bs.length) throw new ParseError(`unexpected bytes after players: ${bs.length}`);
  return players;
}

function findOptions(b: Uint8Array): number | undefined {
  for (let i = 0; i <= b.length - 16; i++) {
    const count = le32At(b, i);
    if (count < 1 || count > 64) continue;
    const ok = attempt(() => {
      const r = new Reader(b, i + 4);
      return r.ascii().startsWith("section_");
    });
    if (ok) return i;
  }
  return undefined;
}

function readOptions(r: Reader): OptionSection[] {
  const out: OptionSection[] = [];
  const n = r.u32();
  for (let i = 0; i < n; i++) {
    const section = r.ascii();
    const k = r.u32();
    const options: Record<string, number> = {};
    for (let j = 0; j < k; j++) {
      const key = r.ascii();
      options[key] = r.u32();
    }
    out.push({ section, options });
  }
  return out;
}

function guessMap(strs: string[]): MapInfo {
  const s = strs.findIndex((x) => x.startsWith("map_size_"));
  const at = (k: number) => (s >= 0 && s + k < strs.length ? strs[s + k] : null);
  return {
    size: at(0),
    name: at(1),
    biome: at(2),
    minimap: strs.find((x) => x.includes("minimap")) ?? null,
  };
}

function words32(b: Uint8Array): number[] | string {
  if (b.length % 4 !== 0) return toHex(b);
  const out: number[] = [];
  for (let i = 0; i < b.length; i += 4) out.push(le32At(b, i));
  return out;
}

export function readGameSetup(r: Reader): GameSetup {
  const unknownHeader: [number, number, number] = [r.u32(), r.u32(), r.u16()];
  const n = r.u32();
  const rest = r.rest();
  const optOff = findOptions(rest);
  const midOff = optOff === undefined
    ? undefined
    : [optOff - 40, optOff - 44].find((k) => k >= 0 && le32At(rest, k) === 8);
  const playerEnd = midOff ?? optOff ?? rest.length;
  const players = splitPlayers(n, rest.subarray(0, playerEnd));
  const afterPlayers = rest.subarray(playerEnd);
  const middle = optOff === undefined ? afterPlayers : afterPlayers.subarray(0, optOff - playerEnd);
  const afterMiddle = optOff === undefined ? new Uint8Array(0) : afterPlayers.subarray(optOff - playerEnd);
  let options: OptionSection[] = [];
  let tail: Uint8Array = new Uint8Array(0);
  if (afterMiddle.length) [options, tail] = runPrefix(afterMiddle, readOptions);
  const strings = scanStrings(tail);
  return {
    unknownHeader,
    players,
    matchId: midOff !== undefined && middle.length >= 20 ? le32At(middle, 16) : null,
    unknownMiddle: words32(middle),
    options,
    map: guessMap(strings),
    strings,
    unknownTail: toHex(tail),
  };
}

export const parseGameSetup = (b: Uint8Array): GameSetup => runExact(b, readGameSetup);
