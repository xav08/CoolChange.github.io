export const sheetSizes = ["collapsed", "half", "full"] as const;
export type SheetSize = typeof sheetSizes[number];

export function sheetAfterDrag(size: SheetSize, deltaY: number): SheetSize {
  if (Math.abs(deltaY) < 40) return size;
  const steps = Math.abs(deltaY) >= 180 ? 2 : 1;
  return sheetSizes[Math.max(0, Math.min(2, sheetSizes.indexOf(size) + (deltaY < 0 ? steps : -steps)))];
}
