/**
 * Source: supplied "Cool Change · Iteration 3 · Epic 7, Equity Analysis" report,
 * Section 3, "By SEIFA decile (population-weighted)".
 * These are the report's rounded group aggregates, not individual SA2 records.
 * Deciles are ABS national SA2 IRSD groups, not Melbourne population deciles.
 * Heat/canopy: 2018; SEIFA and population weights: 2016 Census.
 */
export const equityCanopy = [
  { decile: 1, areas: 17, residents: 289607, canopy: 6.6, surfaceHeat: 9.75 },
  { decile: 2, areas: 17, residents: 260888, canopy: 9.3, surfaceHeat: 9.11 },
  { decile: 3, areas: 19, residents: 304239, canopy: 8.7, surfaceHeat: 9.40 },
  { decile: 4, areas: 15, residents: 242344, canopy: 8.3, surfaceHeat: 9.03 },
  { decile: 5, areas: 26, residents: 383280, canopy: 9.6, surfaceHeat: 9.65 },
  { decile: 6, areas: 28, residents: 423069, canopy: 11.4, surfaceHeat: 8.53 },
  { decile: 7, areas: 38, residents: 563876, canopy: 12.0, surfaceHeat: 8.75 },
  { decile: 8, areas: 47, residents: 662897, canopy: 13.1, surfaceHeat: 8.93 },
  { decile: 9, areas: 53, residents: 756576, canopy: 14.9, surfaceHeat: 8.18 },
  { decile: 10, areas: 35, residents: 457888, canopy: 20.3, surfaceHeat: 7.33 },
] as const;

export const equityAreaCount = equityCanopy.reduce((total, group) => total + group.areas, 0);
export const equityHeatGap = equityCanopy[0].surfaceHeat - equityCanopy[equityCanopy.length - 1].surfaceHeat;
