// Shape of the replay JSON. It matches the output of the Haskell CLI
// (aoe4-replay-json), so the viewer can load either.

export interface Vec3 { x: number; y: number; z: number }

export type Target =
  | { position: Vec3 }
  | { entity: number; entityKind: number }
  | { rotation: [number, number, number, number] };

export interface Entity { kind: number; id: number }

interface ArgBase { tag: number }

export type Arg = ArgBase & (
  | { arg: "end" }
  | { arg: "target"; target: Target }
  | { arg: "count"; value: number }
  | { arg: "offsetTarget"; unknown: number; target: Target }
  | { arg: "targets"; targets: Target[]; unknown: string }
  | { arg: "item"; count: number; pbgid: number }
  | { arg: "produce"; count: number; pbgid: number; playerId: number; unknown: string }
  | { arg: "resign"; kind: number; data: string }
  | { arg: "placement"; count: number; pbgid: number; positions: Vec3[]; unknown1: number; unknown2: string; builders: number[] }
  | { arg: "ability"; count: number; pbgid: number; unknown: number }
  | { arg: "targetedAbility"; count: number; pbgid: number; unknown1: number; unknown2: number; target: Target }
  | { arg: "pointAbility"; count: number; pbgid: number; unknown: number; targets: Target[] }
  | { arg?: undefined; raw: string }
);

export interface Command {
  type: number;
  name: string;
  flags: number;
  sequence: number;
  playerId: number;
  unknown: string;
  raw?: string;
  selection?: Entity[];
  args?: Arg[];
}

export interface Block { hostComputer: number; unknown: number; commands: Command[] }

export interface TickRecord {
  record: "tick";
  tick: number;
  time: number;
  version: number;
  checksum: number;
  blocks: Block[];
}

export interface ChatRecord {
  record: "chat";
  tick: number | null;
  time: number | null;
  kind: number;
  mode: number;
  profileId: number;
  unknown: number;
  sender: string;
  message: string;
}

export interface RawRecord { record: "raw"; type: number; error: string; raw: string }

export type ReplayRecord = TickRecord | ChatRecord | RawRecord;

export interface MapInfo { size: string | null; name: string | null; biome: string | null; minimap: string | null }

export interface Player {
  isHuman: boolean;
  name: string;
  team: number;
  slot: number;
  playerId: number;
  civilization: string;
  preset: string;
  index: number;
  hostComputer: number;
  profileId: number;
  platformId: string;
  attributes: string[];
  unknown: {
    u1: number;
    u2: [number, number, number];
    u3: number[];
    u4: number;
    u5: string;
    tail: string;
  };
}

export interface OptionSection { section: string; options: Record<string, number> }

export interface GameSetup {
  unknownHeader: [number, number, number];
  players: Player[];
  matchId: number | null;
  unknownMiddle: number[] | string;
  options: OptionSection[];
  map: MapInfo;
  strings: string[];
  unknownTail: string;
}

export type DataContent =
  | { durationTicks: number; durationSeconds: number }
  | { gameSetup: GameSetup }
  | { values: number[] }
  | { raw: string; strings: string[]; error?: string };

export interface ChunkyNode {
  type: string;
  id: string;
  version: number;
  name: string;
  children?: ChunkyNode[];
  data?: DataContent;
}

export interface ChunkyFile { version: number; platform: number; nodes: ChunkyNode[] }

export interface SummaryPlayer {
  name: string;
  playerId: number;
  team: number;
  civilization: string;
  profileId: number;
  isHuman: boolean;
}

export interface Summary {
  durationTicks: number | null;
  durationSeconds: number | null;
  matchId: number | null;
  map: MapInfo | null;
  players: SummaryPlayer[];
  chat: { tick: number | null; sender: string; message: string }[];
}

export interface Replay {
  header: { version: number; magic: string; date: string };
  summary: Summary;
  chunky: ChunkyFile[];
  records: ReplayRecord[];
}
