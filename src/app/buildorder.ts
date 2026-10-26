import { type Analysis, collapse } from "./analysis.ts";
import { AGES, formatTime } from "./data.ts";
import { h, icon } from "./dom.ts";

const CATEGORY_LABEL = { unit: "Unit", building: "Building", technology: "Tech" } as const;

export function renderBuildOrder(a: Analysis): HTMLElement {
  const minutes = h("input", { type: "number", min: 1, value: 10, class: "narrow" });
  const show = {
    unit: h("input", { type: "checkbox", checked: true }),
    building: h("input", { type: "checkbox", checked: true }),
    technology: h("input", { type: "checkbox", checked: true }),
  };
  const grid = h("div", { class: "columns" });

  const draw = () => {
    const limit = Number(minutes.value) > 0 ? Number(minutes.value) * 60 : Infinity;
    grid.replaceChildren(...a.players.map((p) => {
      const items = collapse((a.buildOrder.get(p.playerId) ?? [])
        .filter((it) => it.time <= limit && show[it.category].checked));
      return h("section", { class: "card column" },
        h("h3", null, h("span", { class: "swatch", style: `background:${p.color}` }), " ", p.name,
          h("span", { class: "muted" }, ` — ${p.civName}`)),
        items.length
          ? h("ol", { class: "build" }, items.map((it) => {
            const info = a.data.get(it.pbgid);
            const landmark = a.data.isLandmark(it.pbgid);
            const target = a.data.landmarkTargetAge(it.pbgid);
            const tag = !landmark ? CATEGORY_LABEL[it.category]
              : a.data.isWonder(it.pbgid) ? "Wonder"
                : target ? `${AGES[target]} landmark` : "Landmark";
            return h("li", { class: `cat-${it.category}${landmark ? " landmark" : ""}` },
              h("span", { class: "time" }, formatTime(it.time)),
              icon(info?.icon, a.data.name(it.pbgid)),
              h("span", { class: "name" }, a.data.name(it.pbgid), it.count > 1 ? h("span", { class: "count" }, ` ×${it.count}`) : null),
              h("span", { class: "tag" }, tag),
            );
          }))
          : h("p", { class: "muted" }, "Nothing in this range."));
    }));
  };

  for (const el of [minutes, ...Object.values(show)]) el.addEventListener("input", draw);
  draw();

  return h("div", null,
    h("div", { class: "toolbar" },
      h("label", null, "First ", minutes, " minutes (empty = all)"),
      h("label", null, show.unit, " Units"),
      h("label", null, show.building, " Buildings"),
      h("label", null, show.technology, " Techs"),
    ),
    h("p", { class: "note" }, "Orders as given; cancelled items still appear."),
    grid,
  );
}
