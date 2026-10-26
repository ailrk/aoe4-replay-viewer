import type { Analysis } from "./analysis.ts";
import { AGES, formatTime } from "./data.ts";
import { h, icon } from "./dom.ts";

export function renderLandmarks(a: Analysis): HTMLElement {
  const landmarks = a.placements.filter((p) => p.landmark);
  const duration = Math.max(a.durationSeconds, 1);

  const timeline = h("div", { class: "timeline card" },
    h("h2", null, "Timeline"),
    a.players.map((p) =>
      h("div", { class: "timeline-row" },
        h("span", { class: "timeline-label" }, h("span", { class: "swatch", style: `background:${p.color}` }), " ", p.name),
        h("div", { class: "timeline-track" },
          landmarks.filter((l) => l.player === p).map((l) => {
            const info = a.data.get(l.pbgid);
            return h("span", {
              class: "timeline-mark",
              style: `left:${(l.time / duration) * 100}%; border-color:${p.color}`,
              title: `${formatTime(l.time)} ${a.data.name(l.pbgid)}`,
            }, icon(info?.icon, a.data.name(l.pbgid)));
          }),
        ),
      )),
    h("div", { class: "timeline-axis" },
      [0, 0.25, 0.5, 0.75, 1].map((f) => h("span", { style: `left:${f * 100}%` }, formatTime(f * duration)))),
  );

  const columns = h("div", { class: "columns" }, a.players.map((p) => {
    const mine = landmarks.filter((l) => l.player === p);
    const seen = new Set<number>();
    const tiers = new Set<number>();
    return h("section", { class: "card column" },
      h("h3", null, h("span", { class: "swatch", style: `background:${p.color}` }), " ", p.name,
        h("span", { class: "muted" }, ` — ${p.civName}`)),
      mine.length
        ? h("ol", { class: "build" }, mine.map((l) => {
          const info = a.data.get(l.pbgid);
          const target = a.data.landmarkTargetAge(l.pbgid);
          const repeat = seen.has(l.pbgid);
          seen.add(l.pbgid);
          // Only the first landmark of a tier ages the player up.
          const ageUp = target !== null && !tiers.has(target);
          if (target !== null) tiers.add(target);
          const label = a.data.isWonder(l.pbgid) ? "Wonder"
            : target === null ? "Landmark"
              : ageUp ? `Age-up → ${AGES[target]}` : `${AGES[target]} landmark`;
          return h("li", { class: "landmark" },
            h("span", { class: "time" }, formatTime(l.time)),
            icon(info?.icon, a.data.name(l.pbgid)),
            h("span", { class: "name" }, a.data.name(l.pbgid), repeat ? h("span", { class: "muted" }, " (placed again)") : null),
            h("span", { class: "tag" }, label));
        }))
        : h("p", { class: "muted" }, "No landmarks placed."));
  }));

  return h("div", null,
    h("p", { class: "note" }, "Times are placements, not completions."),
    timeline,
    columns,
  );
}
