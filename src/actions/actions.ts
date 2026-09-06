import raw from './sequences.json';

export type Product = 'sub-finance' | 'nav-finance' | 'hybrid-pref' | 'gp-facility';
export type Category = 'universal' | 'conditional' | 'arbitrary';

export interface ActionCard {
  id: string;
  order: number;
  title: string;
  purpose: string;
  purposeAccept: string[];
  action: string;
  actionAccept: string[];
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
