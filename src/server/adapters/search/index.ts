import type { SearchAdapter } from "./adapter";
import { FixtureAdapter } from "./fixtures";
import { SerpApiAdapter } from "./serpapi";
import type { Surface } from "../../../contracts/search";

export function getSearchAdapter(surface: Surface, mode: "live" | "fixture"): SearchAdapter {
  return mode === "fixture" ? new FixtureAdapter(surface) : new SerpApiAdapter(surface);
}
