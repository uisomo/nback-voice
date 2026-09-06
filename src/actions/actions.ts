import raw from './sequences.json';

export type Product = 'sub-finance' | 'nav-finance' | 'hybrid-pref' | 'gp-facility';
export type Category = 'universal' | 'conditional' | 'arbitrary';

/** カード内の一手順。具体アクション段の出題単位。 */
export interface SubAction {
  id: string;
  /** 小目的 — なぜこの一手順を踏むのか。具体アクション段の問題文になる。 */
  purpose: string;
  /** 具体アクション — 実際に何をするか。具体アクション段の答え。 */
  action: string;
  actionAccept: string[];
}

export interface ActionCard {
  id: string;
  order: number;
  /** 手段の総称。刺激として出すが、答えにはしない（spec §2）。 */
  title: string;
  /** 中目的 — なぜその手段をとるのか。判断ロジックを含む。目的段の答え。 */
  purpose: string;
  purposeAccept: string[];
  /** 空なら具体アクション段では飛ばす。layer2Skipped と一致する。 */
  subActions: SubAction[];
  category: Category;
  note?: string;
  layer2Skipped?: boolean;
}

export interface Sequence {
  id: string;
  product: Product;
  goal: string;
  scenario: string;
  credit: string;
  cards: ActionCard[];
}

export const PRODUCT_ORDER: Product[] = [
  'sub-finance',
  'nav-finance',
  'hybrid-pref',
  'gp-facility',
];

const SEQUENCES = raw as Sequence[];

export function listSequences(): Sequence[] {
  return SEQUENCES;
}

export function getSequence(id: string): Sequence | undefined {
  return SEQUENCES.find((s) => s.id === id);
}

export function sequencesByProduct(): { product: Product; sequences: Sequence[] }[] {
  return PRODUCT_ORDER.map((product) => ({
    product,
    sequences: SEQUENCES.filter((s) => s.product === product),
  })).filter((g) => g.sequences.length > 0);
}
