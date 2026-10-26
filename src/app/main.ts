import { parseReplayFile } from "../parser/replay.ts";
import type { Replay } from "../parser/types.ts";
import { type Analysis, analyze } from "./analysis.ts";
import { renderBuildOrder } from "./buildorder.ts";
import { GameData, prettify } from "./data.ts";
import { h } from "./dom.ts";
import { renderLandmarks } from "./landmarks.ts";
import { renderLog } from "./log.ts";
import { renderMap } from "./map.ts";
import { renderOverview } from "./overview.ts";

const API = "https://api.ageofempires.com/api/GameStats/AgeIV/GetMatchReplay/";

const TABS: [string, string, (a: Analysis) => HTMLElement][] = [
  ["overview", "Overview", renderOverview],
  ["map", "Map", renderMap],
  ["build", "Build order", renderBuildOrder],
  ["landmarks", "Landmarks", renderLandmarks],
  ["log", "Command log", renderLog],
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $("status");
const content = $("content");
const tabs = $("tabs");
const matchInput = $<HTMLInputElement>("match-id");
const profileInput = $<HTMLInputElement>("profile-id");

let gameData: Promise<GameData> | null = null;
let current: Analysis | null = null;
const rendered = new Map<string, HTMLElement>();

function setStatus(msg: string, kind: "info" | "error" = "info"): void {
  status.textContent = msg;
  status.className = kind;
  status.hidden = !msg;
}

async function load(source: () => Promise<Replay>, label: string): Promise<void> {
  setStatus(`Loading ${label}…`);
  try {
    gameData ??= GameData.load();
    const [replay, data] = await Promise.all([source(), gameData]);
    current = analyze(replay, data);
    rendered.clear();
    const s = replay.summary;
    const teams = [...new Set(current.players.map((p) => p.team))].sort((x, y) => x - y);
    const matchup = teams
      .map((t) => current!.players.filter((p) => p.team === t).map((p) => p.name).join(", "))
      .join(" vs ");
    document.title = `${matchup} — AoE4 replay`;
    setStatus(data.error ?? "", data.error ? "error" : "info");
    $("match-title").textContent = `${matchup}${s.map?.name ? ` on ${prettify(s.map.name)}` : ""}`;
    tabs.hidden = false;
    showTab(location.hash.slice(1) || "overview");
  } catch (e) {
    setStatus(`Could not load ${label}: ${e instanceof Error ? e.message : e}`, "error");
  }
}

async function fromBytes(bytes: Uint8Array): Promise<Replay> {
  const first = bytes.find((b) => b !== 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09);
  if (first === 0x7b) return JSON.parse(new TextDecoder().decode(bytes)) as Replay;
  return parseReplayFile(bytes);
}

async function fromApi(matchId: string, profileId: string): Promise<Replay> {
  const res = await fetch(`${API}?matchId=${encodeURIComponent(matchId)}&profileId=${encodeURIComponent(profileId)}`);
  if (!res.ok) throw new Error(`replay API returned HTTP ${res.status} (replays are only kept for a limited time)`);
  return fromBytes(new Uint8Array(await res.arrayBuffer()));
}

function showTab(name: string): void {
  if (!current) return;
  const tab = TABS.find((t) => t[0] === name) ?? TABS[0];
  for (const btn of tabs.querySelectorAll("button")) btn.classList.toggle("active", btn.dataset.tab === tab[0]);
  let el = rendered.get(tab[0]);
  if (!el) {
    el = tab[2](current);
    rendered.set(tab[0], el);
  }
  content.replaceChildren(el);
  if (location.hash.slice(1) !== tab[0]) history.replaceState(null, "", `${location.search}#${tab[0]}`);
}

function loadFromInputs(): void {
  let matchId = matchInput.value.trim();
  let profileId = profileInput.value.trim();
  // Accept a pasted replay API URL in the match field.
  if (matchId.includes("matchId=")) {
    const url = new URL(matchId, location.href);
    matchId = url.searchParams.get("matchId") ?? "";
    profileId = url.searchParams.get("profileId") ?? profileId;
    matchInput.value = matchId;
    profileInput.value = profileId;
  }
  if (!/^\d+$/.test(matchId) || !/^\d+$/.test(profileId)) {
    setStatus("Enter a numeric match ID and the profile ID of one of the players.", "error");
    return;
  }
  history.replaceState(null, "", `?matchId=${matchId}&profileId=${profileId}${location.hash}`);
  void load(() => fromApi(matchId, profileId), `match ${matchId}`);
}

function loadFile(file: File): void {
  void load(async () => fromBytes(new Uint8Array(await file.arrayBuffer())), file.name);
}

tabs.replaceChildren(...TABS.map(([id, label]) =>
  h("button", { "data-tab": id, onclick: () => showTab(id) }, label)));

$("load-form").addEventListener("submit", (e) => {
  e.preventDefault();
  loadFromInputs();
});

const fileInput = $<HTMLInputElement>("file");
fileInput.addEventListener("change", () => {
  if (fileInput.files?.[0]) loadFile(fileInput.files[0]);
});

document.addEventListener("dragover", (e) => {
  e.preventDefault();
  document.body.classList.add("dragging");
});
document.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null) document.body.classList.remove("dragging");
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("dragging");
  const file = e.dataTransfer?.files[0];
  if (file) loadFile(file);
});

window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));

const params = new URLSearchParams(location.search);
if (params.get("matchId") && params.get("profileId")) {
  matchInput.value = params.get("matchId")!;
  profileInput.value = params.get("profileId")!;
  loadFromInputs();
} else if (params.get("replay")) {
  // Load a replay hosted next to the site, e.g. ?replay=sample-replay.gz
  const path = params.get("replay")!;
  void load(async () => {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return fromBytes(new Uint8Array(await res.arrayBuffer()));
  }, path);
}
