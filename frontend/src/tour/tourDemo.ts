import { plantingMilestones } from "../utils/plantingMilestones";
import type { MeshblockDetail } from "../components/MelbourneMapPage";
import { mostCommon, pickDemoBlocks, type DemoCandidate } from "./tourLogic";
import type { TourDemo, TourSuburb } from "./tourTypes";

const STREET = "North Road";
const STREET_SHORT = "North";
const SUBURB = "Clayton";
const MAX_CANDIDATES = 8;

type StreetResult = { road_name: string; road_type: string; blocks: { mb_code16: string; n_addresses: number; sa2_code16: string }[] };

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

// Find the tour's suburb and the best North Road blocks to demonstrate with.
// Checked live so the tour keeps working if the data release changes.
export async function resolveTourDemo(apiBase: string, suburbSummary: (code: string) => TourSuburb | null, signal: AbortSignal): Promise<TourDemo> {
  // The street endpoint prefix-matches road names; try the full name first, then
  // the bare name filtered to roads, in case road type is stored separately.
  let query = `${STREET}, ${SUBURB}`;
  let streets = (await getJson<{ results: StreetResult[] }>(`${apiBase}/street-search?street=${encodeURIComponent(STREET)}&suburb=${encodeURIComponent(SUBURB)}`, signal)).results;
  if (!streets.some(result => result.blocks.length)) {
    const loose = (await getJson<{ results: StreetResult[] }>(`${apiBase}/street-search?street=${encodeURIComponent(STREET_SHORT)}&suburb=${encodeURIComponent(SUBURB)}`, signal)).results;
    streets = loose.filter(result => /^north$/i.test(result.road_name.trim()) && /^(road|rd)$/i.test(result.road_type.trim()));
    query = `${STREET_SHORT}, ${SUBURB}`;
  }
  const blocks = streets.flatMap(result => result.blocks);
  const suburbCode = mostCommon(blocks.map(block => block.sa2_code16));

  let suburb = suburbCode ? suburbSummary(suburbCode) : null;
  if (!suburb) {
    const search = await getJson<{ results: TourSuburb[] }>(`${apiBase}/search?q=${encodeURIComponent(SUBURB)}`, signal);
    const match = search.results.find(result => result.sa2_name.toLowerCase() === SUBURB.toLowerCase()) ?? search.results[0];
    if (!match) throw new Error("The tour suburb could not be found.");
    suburb = { ...match, ...(suburbSummary(match.sa2_code16) ?? {}) };
  }

  const inSuburb = blocks
    .filter(block => block.sa2_code16 === suburb.sa2_code16)
    .sort((a, b) => b.n_addresses - a.n_addresses)
    .slice(0, MAX_CANDIDATES);
  const details = await Promise.all(inSuburb.map(block =>
    getJson<MeshblockDetail>(`${apiBase}/meshblocks/${block.mb_code16}`, signal).catch(() => null)));
  const candidates: DemoCandidate[] = inSuburb.map((block, index) => {
    const model = details[index]?.simulator?.interactive ?? null;
    return {
      code: block.mb_code16,
      hasModel: !!model,
      sourceKind: model?.source_kind ?? null,
      unavailable: !!model?.unavailable_reason,
      maxTrees: model?.max_trees ?? 0,
      milestoneCount: model ? plantingMilestones(model, suburb.canopy_mean ?? null).length : 0,
      streetCount: details[index]?.streets.length ?? 0,
    };
  });
  const { primary, secondary } = pickDemoBlocks(candidates);
  return { suburb, streetName: STREET, streetQuery: query, primary, secondary };
}
