import { type Analysis, type Event, SYSTEM_TYPES, describe } from "./analysis.ts";
import { formatTime } from "./data.ts";
import { h } from "./dom.ts";

const PAGE = 200;

export function renderLog(a: Analysis): HTMLElement {
  const playerSel = h("select", null,
    h("option", { value: "" }, "All players"),
    a.players.map((p) => h("option", { value: p.playerId }, p.name)));

  const counts = new Map<string, number>();
  for (const e of a.events) counts.set(e.cmd.name, (counts.get(e.cmd.name) ?? 0) + 1);
  const typeSel = h("select", null,
    h("option", { value: "" }, "All commands"),
    [...counts].sort((x, y) => x[0].localeCompare(y[0])).map(([n, c]) => h("option", { value: n }, `${n} (${c})`)));

  const system = h("input", { type: "checkbox" });
  const search = h("input", { type: "search", placeholder: "Search details…" });
  const info = h("span", { class: "muted" });
  const prev = h("button", null, "‹ Prev");
  const next = h("button", null, "Next ›");
  const body = h("tbody");
  let page = 0;
  let rows: Event[] = [];

  const filter = () => {
    const pid = playerSel.value ? Number(playerSel.value) : null;
    const type = typeSel.value;
    const q = search.value.trim().toLowerCase();
    rows = a.events.filter((e) =>
      (system.checked || !SYSTEM_TYPES.has(e.cmd.type)) &&
      (pid === null || e.cmd.playerId === pid) &&
      (!type || e.cmd.name === type) &&
      (!q || describe(e.cmd, a.data).toLowerCase().includes(q) || e.cmd.name.toLowerCase().includes(q)));
    page = 0;
    draw();
  };

  const draw = () => {
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    page = Math.min(page, pages - 1);
    info.textContent = `${rows.length} commands · page ${page + 1} of ${pages}`;
    prev.disabled = page === 0;
    next.disabled = page >= pages - 1;
    body.replaceChildren(...rows.slice(page * PAGE, (page + 1) * PAGE).map((e) =>
      h("tr", null,
        h("td", { class: "time" }, formatTime(e.time)),
        h("td", null, e.player
          ? [h("span", { class: "swatch", style: `background:${e.player.color}` }), " ", e.player.name]
          : h("span", { class: "muted" }, e.cmd.playerId ? `#${e.cmd.playerId}` : "system")),
        h("td", null, e.cmd.name),
        h("td", { class: "num" }, e.cmd.selection?.length ?? ""),
        h("td", null, describe(e.cmd, a.data)),
      )));
  };

  for (const el of [playerSel, typeSel, system]) el.addEventListener("change", filter);
  search.addEventListener("input", filter);
  prev.addEventListener("click", () => { page--; draw(); });
  next.addEventListener("click", () => { page++; draw(); });
  filter();

  return h("div", null,
    h("div", { class: "toolbar" }, playerSel, typeSel, h("label", null, system, " Show system packets"), search),
    h("div", { class: "toolbar" }, prev, next, info),
    h("table", { class: "log" },
      h("thead", null, h("tr", null, ["Time", "Player", "Command", "Units", "Details"].map((c) => h("th", null, c)))),
      body),
  );
}
