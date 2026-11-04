import type { SearchPlan, FilterHints } from './query';
import type { Expansion } from './discussions';
export interface SearchWork {
  run: number;
  plan: SearchPlan;
  hints: FilterHints;
  documents: {id: string; text: string}[];
}
export type SearchReply =
  | {run: number; type: 'plan'; expansion: Expansion}
  | {run: number; type: 'scores'; scores: [string, number][]; done: boolean}
  | {run: number; type: 'error'};
