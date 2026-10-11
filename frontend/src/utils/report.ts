import { calculatePlanting, type PlantingModel, type PlantingScenario } from './planting.ts';
import type { ProjectionBand, WarmingLevel } from './projections.ts';

export type ReportItem = { code: string; street: string };
export type ReportSelection = { suburbCode: string; items: ReportItem[] };
export type ReportSuburb = { sa2_code16: string; sa2_name: string; persons?: number | null };
export type ReportDetail = {
  block: { mb_code16: string; persons: number | null; uhi_mean: number | null; canopy_pct: number | null; area_sqkm: number | null };
  streets: string[];
  simulator?: { release_id: string; interactive?: PlantingModel } | null;
};
export type ReportBlock = {
  code: string; street: string; population: number | null; area: number | null;
  trees: number; baselineHeat: number | null; simulatedHeat: number | null; cooling: number | null;
  baselineCanopy: number | null; simulatedCanopy: number | null; canopyChange: number | null;
  range: readonly [number, number] | null; model: PlantingModel | null; release: string | null;
};
export type ReportSnapshot = {
  suburb: ReportSuburb; createdAt: string; warming: WarmingLevel; projection: ProjectionBand | null;
  blocks: ReportBlock[]; population: number | null; populationIncluded: number; trees: number;
  overall: { baseline: number; simulated: number; cooling: number; included: number } | null;
};

export const firstStreet = (streets: string[]) => streets.find(street => street.trim())?.trim() || 'Street not available';
const available = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const numberOrNull = (value: unknown) => available(value) ? value : null;

export function reportForSuburb(selection: ReportSelection, suburbCode: string): ReportSelection {
  return selection.suburbCode === suburbCode ? selection : { suburbCode, items: [] };
}

export function toggleReportBlock(selection: ReportSelection, suburbCode: string, item: ReportItem): ReportSelection {
  const current = reportForSuburb(selection, suburbCode);
  return { suburbCode, items: current.items.some(row => row.code === item.code)
    ? current.items.filter(row => row.code !== item.code) : [...current.items, item] };
}

export function buildReport(input: {
  suburb: ReportSuburb; createdAt: string; warming: WarmingLevel; projection: ProjectionBand | null;
  codes: string[]; details: ReportDetail[]; scenarios: PlantingScenario[];
}): ReportSnapshot {
  const blocks = [...new Set(input.codes)].map(code => {
    const detail = input.details.find(item => item.block?.mb_code16 === code);
    if (!detail || !Array.isArray(detail.streets)) throw new Error(`Details for block ${code} are unavailable. Please retry.`);
    const scenario = input.scenarios.find(item => item.code === code && item.suburb_code === input.suburb.sa2_code16);
    const model = detail.simulator?.interactive ?? null;
    if (scenario && (scenario.release !== detail.simulator?.release_id || !model || model.unavailable_reason ||
      !available(model.slope) || model.slope >= 0 || scenario.trees > model.max_trees)) {
      throw new Error(`The planting model for block ${code} has changed. Reopen that block, review its trees, then export again.`);
    }
    const result = model ? calculatePlanting(model, scenario?.trees ?? 0) : null;
    const baselineHeat = numberOrNull(model?.baseline_heat_c ?? detail.block.uhi_mean);
    const baselineCanopy = numberOrNull(model?.baseline_canopy_pct ?? detail.block.canopy_pct);
    const simulatedHeat = scenario ? numberOrNull(result?.heat) : baselineHeat;
    const simulatedCanopy = scenario ? numberOrNull(result?.canopy) : baselineCanopy;
    const rawArea = model?.area_m2 ?? (available(detail.block.area_sqkm) ? detail.block.area_sqkm * 1e6 : null);
    return {
      code, street: firstStreet(detail.streets), population: numberOrNull(detail.block.persons),
      area: available(rawArea) && rawArea > 0 ? rawArea : null,
      trees: result?.trees ?? 0, baselineHeat, simulatedHeat,
      cooling: baselineHeat !== null && simulatedHeat !== null ? baselineHeat - simulatedHeat : null,
      baselineCanopy, simulatedCanopy,
      canopyChange: baselineCanopy !== null && simulatedCanopy !== null ? simulatedCanopy - baselineCanopy : null,
      range: scenario ? result?.range ?? null : null, model, release: detail.simulator?.release_id ?? null,
    };
  });
  if (!blocks.length) throw new Error('Add at least one block to the report.');
  const complete = blocks.filter(block => block.area !== null && block.baselineHeat !== null && block.simulatedHeat !== null);
  const area = complete.reduce((total, block) => total + block.area!, 0);
  const baseline = area ? complete.reduce((total, block) => total + block.area! * block.baselineHeat!, 0) / area : 0;
  const simulated = area ? complete.reduce((total, block) => total + block.area! * block.simulatedHeat!, 0) / area : 0;
  const counted = blocks.filter(block => block.population !== null);
  return {
    suburb: { ...input.suburb, persons: numberOrNull(input.suburb.persons) }, createdAt: input.createdAt,
    warming: input.warming, projection: input.projection ? { ...input.projection } : null, blocks,
    population: counted.length ? counted.reduce((total, block) => total + block.population!, 0) : null,
    populationIncluded: counted.length, trees: blocks.reduce((total, block) => total + block.trees, 0),
    overall: area ? { baseline, simulated, cooling: baseline - simulated, included: complete.length } : null,
  };
}
