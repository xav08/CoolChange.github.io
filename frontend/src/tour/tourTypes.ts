import type { BlockTab } from "../components/SelectedBlockPanel";
import type { SheetSize } from "../utils/explorerSheet";
import type { WarmingLevel } from "../utils/projections";
import type { Rect } from "./tourLogic";

export type TourSuburb = {
  sa2_code16: string;
  sa2_name: string;
  lga_name: string;
  n_blocks: number;
  uhi_mean?: number | null;
  canopy_mean?: number | null;
};

// A read-only snapshot of the map page, refreshed on every render.
export type TourState = {
  mapReady: boolean;
  future: boolean;
  warming: WarmingLevel;
  projectionStatus: "idle" | "loading" | "ready" | "error";
  projectionDays: string | null;
  suburbCode: string | null;
  meshReady: boolean;
  highlighted: number;
  blockCode: string | null;
  blockLoading: boolean;
  tab: BlockTab;
  trees: number;
  maxTrees: number;
  milestones: { trees: number; labels: string[] }[];
  comparison: "before" | "after";
  plantedBlocks: number;
};

// Everything the tour is allowed to do to the map page.
export type TourController = {
  apiBase: string;
  begin: () => void;
  end: () => void;
  setFuture: (on: boolean) => void;
  setWarming: (level: WarmingLevel) => void;
  showAll: () => void;
  openSuburb: (suburb: TourSuburb, searchText: string) => void;
  streetSearch: (text: string) => void;
  clearHighlight: () => void;
  openBlock: (code: string) => void;
  closeBlock: () => void;
  setTab: (tab: BlockTab) => void;
  setTrees: (trees: number) => void;
  setComparison: (value: "before" | "after") => void;
  setSheet: (size: SheetSize) => void;
  openPlantedList: () => void;
  suburbSummary: (code: string) => TourSuburb | null;
  suburbRect: () => Rect | null;
  blockRect: (code: string) => Rect | null;
};

export type TourDemo = {
  suburb: TourSuburb;
  streetName: string;   // "North Road"
  streetQuery: string;  // the exact text that returned results, e.g. "North Road, Clayton"
  primary: string | null;
  secondary: string | null;
};

// Desired map state for a step. Undefined fields are left alone.
export type TourScene = {
  future?: boolean;
  warming?: WarmingLevel;
  suburb?: "none" | "demo";
  highlight?: boolean;
  block?: "none" | "primary" | "secondary";
  tab?: BlockTab;
  trees?: "zero" | "few" | "milestone";
  comparison?: "before" | "after";
  sheet?: SheetSize;
  openPlantedList?: boolean;
};

export type TourTarget =
  | { kind: "element"; selectors: string[] }
  | { kind: "suburb" }
  | { kind: "block"; which: "primary" | "secondary" }
  | { kind: "none" };

type Text = string | ((demo: TourDemo, state: TourState) => string);

export type TourStep = {
  id: string;
  chapter: 0 | 1 | 2 | 3 | 4 | 5; // 0 = welcome, 5 = finish
  title: Text;
  body: Text;
  target: TourTarget;
  scene?: TourScene;
  // An "action" step: the user can do it themselves, or press Show me.
  action?: {
    label?: string;
    done: (state: TourState, demo: TourDemo) => boolean;
    hint?: (state: TourState, demo: TourDemo) => string | null;
  };
};
