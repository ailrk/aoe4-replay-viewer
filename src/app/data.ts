// Game data (names, icons, classes) from aoe4world's hosted data files,
// keyed by pbgid, plus display helpers.

export type Category = "unit" | "building" | "technology" | "ability";

export interface GameItem {
  pbgid: number;
  name: string;
  icon: string | null;
  category: Category;
  classes: string[];
  displayClasses: string[];
  age: number;
  /** Build or research time in seconds (base value, before bonuses). */
  time: number;
}

const SOURCES: [Category, string][] = [
  ["unit", "units"],
  ["building", "buildings"],
  ["technology", "technologies"],
  ["ability", "abilities"],
];

interface RawItem {
  name?: string;
  icon?: string;
  age?: number;
  classes?: string[];
  displayClasses?: string[];
  pbgid?: number;
  costs?: { time?: number };
  variations?: RawItem[];
}

export class GameData {
  readonly items = new Map<number, GameItem>();
  error: string | null = null;

  get(pbgid: number): GameItem | undefined {
    return this.items.get(pbgid);
  }

  name(pbgid: number): string {
    return this.items.get(pbgid)?.name ?? `#${pbgid}`;
  }

  isLandmark(pbgid: number): boolean {
    const it = this.items.get(pbgid);
    if (!it) return false;
    return it.classes.includes("landmark") || it.classes.includes("wonder") ||
      it.displayClasses.some((d) => d.includes("Landmark") || d.includes("Wonder"));
  }

  /** Age a landmark advances to, from display classes such as "Age II - Military Landmark". */
  landmarkTargetAge(pbgid: number): number | null {
    for (const d of this.items.get(pbgid)?.displayClasses ?? []) {
      const m = /^Age (IV|III|II|I)\b/.exec(d);
      if (m && d.includes("Landmark")) return ["I", "II", "III", "IV"].indexOf(m[1]) + 1;
    }
    return null;
  }

  /** Real wonders. Landmarks also carry the internal "wonder" class, so use the display class. */
  isWonder(pbgid: number): boolean {
    return this.items.get(pbgid)?.displayClasses.includes("Wonder") ?? false;
  }

  /**
   * Age an item advances its owner to: a landmark, or an age-up technology such as
   * the Abbasid wings ("Advance to Age II"). Null for anything else.
   */
  ageUpTarget(pbgid: number): number | null {
    const it = this.items.get(pbgid);
    if (!it || this.isWonder(pbgid)) return null;
    if (this.isLandmark(pbgid)) return this.landmarkTargetAge(pbgid);
    if (!it.classes.includes("age_up_upgrade")) return null;
    for (const d of it.displayClasses) {
      const m = /^Advance to Age (IV|III|II)\b/.exec(d);
      if (m) return ["I", "II", "III", "IV"].indexOf(m[1]) + 1;
    }
    return null;
  }

  static async load(base = "https://data.aoe4world.com"): Promise<GameData> {
    const data = new GameData();
    const results = await Promise.allSettled(
      SOURCES.map(async ([category, file]) => {
        const res = await fetch(`${base}/${file}/all-optimized.json`);
        if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
        return [category, (await res.json()).data as RawItem[]] as const;
      }),
    );
    const errors: string[] = [];
    for (const r of results) {
      if (r.status === "rejected") {
        errors.push(String(r.reason));
        continue;
      }
      const [category, items] = r.value;
      for (const it of items) {
        for (const v of it.variations ?? [it]) {
          if (typeof v.pbgid !== "number" || data.items.has(v.pbgid)) continue;
          data.items.set(v.pbgid, {
            pbgid: v.pbgid,
            name: v.name ?? it.name ?? `#${v.pbgid}`,
            icon: v.icon ?? it.icon ?? null,
            category,
            classes: v.classes ?? it.classes ?? [],
            displayClasses: v.displayClasses ?? it.displayClasses ?? [],
            age: v.age ?? it.age ?? 0,
            time: v.costs?.time ?? it.costs?.time ?? 0,
          });
        }
      }
    }
    if (errors.length) data.error = `Could not load some game data (${errors.join("; ")}); showing ids instead.`;
    return data;
  }
}

const CIVS: Record<string, string> = {
  abbasid: "Abbasid Dynasty",
  abbasid_ha_01: "Ayyubids",
  byzantine: "Byzantines",
  chinese: "Chinese",
  chinese_ha_01: "Zhu Xi's Legacy",
  english: "English",
  french: "French",
  french_ha_01: "Jeanne d'Arc",
  hre: "Holy Roman Empire",
  hre_ha_01: "Order of the Dragon",
  japanese: "Japanese",
  malian: "Malians",
  mongol: "Mongols",
  ottoman: "Ottomans",
  rus: "Rus",
};

export function civName(code: string): string {
  return CIVS[code] ?? prettify(code);
}

export function prettify(code: string): string {
  return code
    .replace(/^[0-9a-f]{32}:/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export const AGES = ["", "Dark Age", "Feudal Age", "Castle Age", "Imperial Age"];

// In-game age emblems, hosted by the Age of Empires Series Wiki.
const WIKI_IMAGES = "https://static.wikia.nocookie.net/ageofempires/images";
export const AGE_ICONS = [
  "",
  `${WIKI_IMAGES}/5/54/GameIcon-DarkAgeAoE4.png`,
  `${WIKI_IMAGES}/b/b2/GameIcon-FeudalAgeAoE4.png`,
  `${WIKI_IMAGES}/8/88/GameIcon-CastleAgeAoE4.png`,
  `${WIKI_IMAGES}/e/e0/GameIcon-ImperialAgeAoE4.png`,
];

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
