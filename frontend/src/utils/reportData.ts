import { buildReport, type ReportDetail, type ReportSuburb } from './report.ts';
import type { WarmingLevel } from './projections.ts';
import type { PlantingScenario } from './planting.ts';

// Bound concurrent detail requests so large reports do not flood the API.
export async function loadReport(input: {
  apiBase: string; suburb: ReportSuburb; codes: string[]; scenarios: PlantingScenario[];
  warming: WarmingLevel; createdAt: string; signal: AbortSignal;
}, fetcher: typeof fetch = fetch) {
  async function read(path: string): Promise<unknown> {
    const response = await fetcher(`${input.apiBase}${path}`, { signal: input.signal });
    if (!response.ok) throw new Error('Report data could not be loaded. Please retry.');
    return response.json();
  }
  const details: ReportDetail[] = [];
  for (let offset = 0; offset < input.codes.length; offset += 4) {
    const batch = await Promise.all(input.codes.slice(offset, offset + 4).map(async code => {
      const value = await read(`/meshblocks/${encodeURIComponent(code)}`) as ReportDetail | null;
      if (!value?.block || value.block.mb_code16 !== code || !Array.isArray(value.streets) ||
        !value.streets.every(street => typeof street === 'string')) throw new Error(`Details for block ${code} could not be read. Please retry.`);
      return value;
    }));
    details.push(...batch);
  }
  return buildReport({ ...input, details, projection: null });
}
