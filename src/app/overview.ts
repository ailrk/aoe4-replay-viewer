import { TICKS_PER_SECOND } from "../parser/replay.ts";
import type { Analysis } from "./analysis.ts";
import { formatTime, prettify } from "./data.ts";
import { h } from "./dom.ts";

export function renderOverview(a: Analysis): HTMLElement {
  const s = a.replay.summary;
  const setup = findSetup(a);
  const teams = [...new Set(a.players.map((p) => p.team))].sort((x, y) => x - y);

  const facts: [string, Node | string][] = [
    ["Map", s.map?.name ? prettify(s.map.name) : "unknown"],
    ["Biome", s.map?.biome ? prettify(s.map.biome) : "unknown"],
    ["Map size", s.map?.size ? prettify(s.map.size.replace("map_size_", "")) : "unknown"],
    ["Duration", formatTime(a.durationSeconds)],
    ["Recorded", a.replay.header.date || "unknown"],
    ["Match ID", s.matchId === null ? "unknown" : String(s.matchId)],
  ];

  const winConditions = setup?.options
    .find((o) => o.section === "section_inner_win_conditions")?.options ?? {};
  const enabledWins = Object.entries(winConditions)
    .filter(([, v]) => v !== 0)
    .map(([k]) => prettify(k.replace("option_win_condition_", "")));

  return h("div", { class: "overview" },
    h("section", { class: "card" },
      h("h2", null, "Match"),
      h("dl", { class: "facts" }, facts.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])),
      enabledWins.length ? h("p", null, h("strong", null, "Victory conditions: "), enabledWins.join(", ")) : null,
    ),
    h("section", { class: "card" },
      h("h2", null, "Players"),
      h("table", { class: "players" },
        h("thead", null, h("tr", null, ["", "Player", "Civilization", "Team", "Actions", "APM"].map((c) => h("th", null, c)))),
        h("tbody", null, teams.flatMap((t) => a.players.filter((p) => p.team === t).map((p) =>
          h("tr", null,
            h("td", null, h("span", { class: "swatch", style: `background:${p.color}` })),
            h("td", null, p.isHuman && p.profileId
              ? h("a", { href: `https://aoe4world.com/players/${p.profileId}`, target: "_blank", rel: "noopener" }, p.name)
              : p.name, p.isHuman ? null : h("span", { class: "muted" }, " (AI)")),
            h("td", null, p.civName),
            h("td", null, t),
            h("td", { class: "num" }, p.actions),
            h("td", { class: "num" }, p.apm.toFixed(0)),
          )))),
      ),
    ),
    h("section", { class: "card" },
      h("h2", null, "Chat"),
      s.chat.length
        ? h("ul", { class: "chat" }, s.chat.map((c) =>
          h("li", null, h("span", { class: "time" }, c.tick === null ? "" : formatTime(c.tick / TICKS_PER_SECOND)), " ",
            h("strong", null, c.sender), ": ", c.message)))
        : h("p", { class: "muted" }, "No chat messages."),
    ),
  );
}

function findSetup(a: Analysis) {
  for (const f of a.replay.chunky) {
    for (const n of f.nodes) {
      for (const c of n.children ?? []) {
        if (c.data && "gameSetup" in c.data) return c.data.gameSetup;
      }
    }
  }
  return undefined;
}
