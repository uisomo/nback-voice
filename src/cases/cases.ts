import raw from './cases.json';

export type Product = 'sub-finance' | 'nav-finance' | 'hybrid-pref' | 'gp-facility';
export type SheetGroup = 'terms' | 'collateral' | 'investors' | 'legal' | 'risk';

export interface SheetField {
  label: string;
  value: string;
  group: SheetGroup;
}

export interface Turn {
  speaker: string;
  line: string;
  note?: string;
}

export interface LoanCase {
  id: string;
  product: Product;
  title: string;
  credit: string;
  sheet: SheetField[];
  conversation: Turn[];
}

export const PRODUCT_ORDER: Product[] = [
  'sub-finance',
  'nav-finance',
  'hybrid-pref',
  'gp-facility',
];

const CASES = raw as LoanCase[];

export function listCases(): LoanCase[] {
  return CASES;
}

export function getCase(id: string): LoanCase | undefined {
  return CASES.find((c) => c.id === id);
}

export function casesByProduct(): { product: Product; cases: LoanCase[] }[] {
  return PRODUCT_ORDER.map((product) => ({
    product,
    cases: CASES.filter((c) => c.product === product),
  })).filter((g) => g.cases.length > 0);
}
