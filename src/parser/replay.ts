// Parser for Age of Empires IV replay files (port of AoE4.Replay).
//
//   u32 ?, "AOE4_RE\0", wchar date[32]
//   Relic Chunky file  (FOLD:POST  -> DATA:DATA = duration in ticks)
//   Relic Chunky file  (DATA:SDSC, FOLD:INFO -> DATA:DATA setup, PLAS, GRIF)
//   record stream      (u32 type, u32 size, body) until end of file

import { Reader, ParseError, decodeUtf16, latin1, runExact, scanStrings, toHex } from "./binary.ts";
import { readCommand } from "./command.ts";
import { parseGameSetup } from "./setup.ts";
import type {
  Block, ChatRecord, ChunkyFile, ChunkyNode, Command, DataContent, GameSetup, Replay, ReplayRecord, Summary,
} from "./types.ts";

export const TICKS_PER_SECOND = 8;
const seconds = (t: number) => t / TICKS_PER_SECOND;

const CHUNKY_MAGIC = "Relic Chunky\r\n\x1a\0";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function tryOr<T>(f: () => T, onError: (msg: string) => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof ParseError || e instanceof RangeError) return onError(errorMessage(e));
    throw e;
  }
}

function peekString(r: Reader, n: number): string {
  return r.remaining >= n ? latin1(r.buf.subarray(r.pos, r.pos + n)) : "";
}

function readChunkyFiles(r: Reader): ChunkyFile[] {
  const files: ChunkyFile[] = [];
  while (peekString(r, 16) === CHUNKY_MAGIC) {
    r.bytes(16);
    const version = r.u32();
    const platform = r.u32();
    const nodes: ChunkyNode[] = [];
    while (["FOLD", "DATA"].includes(peekString(r, 4))) nodes.push(readNode(r, ""));
    files.push({ version, platform, nodes });
  }
  return files;
}

function readNode(r: Reader, parent: string): ChunkyNode {
  const type = latin1(r.bytes(4));
  const id = latin1(r.bytes(4));
  const version = r.u32();
  const len = r.u32();
  const name = r.ascii();
  const body = r.bytes(len);
  const node: ChunkyNode = { type, id, version, name };
  if (type === "FOLD") {
    node.children = runExact(body, (b) => {
      const out: ChunkyNode[] = [];
      while (!b.isEmpty()) out.push(readNode(b, id));
      return out;
    });
  } else {
    node.data = decodeData(parent, id, body);
  }
  return node;
}

function decodeData(parent: string, id: string, body: Uint8Array): DataContent {
  const raw = (error?: string): DataContent =>
    error === undefined
      ? { raw: toHex(body), strings: scanStrings(body) }
      : { raw: toHex(body), strings: scanStrings(body), error };
  const counted = (r: Reader) => {
    const n = r.u32();
    const values: number[] = [];
    for (let i = 0; i < n; i++) values.push(r.u32());
    return { values };
  };
  if (parent === "POST" && id === "DATA") {
    return tryOr(() => runExact(body, (r) => {
      const t = r.u32();
      return { durationTicks: t, durationSeconds: seconds(t) };
    }), raw);
  }
  if (parent === "INFO" && id === "DATA") return tryOr(() => ({ gameSetup: parseGameSetup(body) }), raw);
  if (id === "PLAS" || id === "GRIF") return tryOr(() => runExact(body, counted), raw);
  return raw();
}

function readTick(r: Reader): ReplayRecord {
  const version = r.u8();
  const tick = r.u32();
  const checksum = r.u32();
  const count = r.u32();
  const blocks: Block[] = [];
  for (let i = 0; i < count; i++) {
    const hostComputer = r.u32();
    const unknown = r.u32();
    const body = r.bytes(r.u32());
    const commands = runExact(body, (b) => {
      const out: Command[] = [];
      while (!b.isEmpty()) out.push(readCommand(b));
      return out;
    });
    blocks.push({ hostComputer, unknown, commands });
  }
  return { record: "tick", tick, time: seconds(tick), version, checksum, blocks };
}

function readChat(r: Reader, lastTick: number | null): ChatRecord {
  const kind = r.u32();
  r.u32();
  if (kind !== 1) throw new ParseError(`unsupported message kind ${kind}`);
  return {
    record: "chat",
    tick: lastTick,
    time: lastTick === null ? null : seconds(lastTick),
    kind,
    mode: r.u32(),
    profileId: r.u32(),
    unknown: r.u32(),
    sender: r.utf16(),
    message: r.utf16(),
  };
}

function readRecords(r: Reader): ReplayRecord[] {
  const out: ReplayRecord[] = [];
  let lastTick: number | null = null;
  while (!r.isEmpty()) {
    const type = r.u32();
    const body = r.bytes(r.u32());
    const raw = (error: string): ReplayRecord => ({ record: "raw", type, error, raw: toHex(body) });
    let rec: ReplayRecord;
    if (type === 0) rec = tryOr(() => runExact(body, readTick), raw);
    else if (type === 1) rec = tryOr(() => runExact(body, (b) => readChat(b, lastTick)), raw);
    else rec = raw("unknown record type");
    if (rec.record === "tick") lastTick = rec.tick;
    out.push(rec);
  }
  return out;
}

function flatten(nodes: ChunkyNode[]): ChunkyNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
}

function summarize(chunky: ChunkyFile[], records: ReplayRecord[]): Summary {
  const nodes = chunky.flatMap((c) => flatten(c.nodes));
  let duration: number | null = null;
  let setup: GameSetup | null = null;
  for (const n of nodes) {
    if (duration === null && n.data && "durationTicks" in n.data) duration = n.data.durationTicks;
    if (setup === null && n.data && "gameSetup" in n.data) setup = n.data.gameSetup;
  }
  return {
    durationTicks: duration,
    durationSeconds: duration === null ? null : seconds(duration),
    matchId: setup?.matchId ?? null,
    map: setup?.map ?? null,
    players: (setup?.players ?? []).map((p) => ({
      name: p.name, playerId: p.slot + 1000, team: p.team,
      civilization: p.civilization, profileId: p.profileId, isHuman: p.isHuman,
    })),
    chat: records.flatMap((c) => (c.record === "chat" ? [{ tick: c.tick, sender: c.sender, message: c.message }] : [])),
  };
}

/** Parse an uncompressed replay. */
export function parseReplay(buf: Uint8Array): Replay {
  const r = new Reader(buf);
  try {
    const version = r.u32();
    const magic = latin1(r.bytes(8));
    if (magic !== "AOE4_RE\0") throw new ParseError("not an AoE4 replay (missing AOE4_RE magic)");
    const date = decodeUtf16(r.bytes(64));
    const chunky = readChunkyFiles(r);
    const records = readRecords(r);
    return {
      header: { version, magic: magic.replace(/\0+$/, ""), date: date.split("\0")[0] },
      summary: summarize(chunky, records),
      chunky,
      records,
    };
  } catch (e) {
    if (e instanceof ParseError) throw new ParseError(`parse error at byte ${r.pos}: ${e.message}`);
    throw e;
  }
}

/** Decompress if gzip-wrapped (as served by the replay API), then parse. */
export async function parseReplayFile(data: Uint8Array): Promise<Replay> {
  return parseReplay(await maybeGunzip(data));
}

export async function maybeGunzip(data: Uint8Array): Promise<Uint8Array> {
  if (data.length < 2 || data[0] !== 0x1f || data[1] !== 0x8b) return data;
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
