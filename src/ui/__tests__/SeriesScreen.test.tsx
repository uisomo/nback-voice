import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { FUNDS_FINANCE_CATEGORIES } from '../../content/series';
import { addCustom, addCustomDeck, saveN } from '../../store/storage';
import { SeriesScreen } from '../SeriesScreen';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('SeriesScreen', () => {
  it('lists categories in declaration order', async () => {
    render(<SeriesScreen onSelect={jest.fn()} onOpenSettings={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('金融の語彙を体に入れる')).toBeTruthy();
    });
    expect(screen.getByText('伝え方を変える')).toBeTruthy();
    expect(screen.getByText('だれでも答えられる')).toBeTruthy();
  });

  it('shows each series with its question count and 出典', async () => {
    render(<SeriesScreen onSelect={jest.fn()} onOpenSettings={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('コミットメントとキャピタルコール')).toBeTruthy();
    });
    expect(screen.getByTestId('series-count-capital-call')).toHaveTextContent('14問');
    expect(
      screen.getAllByText('『ファンドファイナンスの教科書』より').length,
    ).toBeGreaterThan(0);
  });

  it('selects a series on press', async () => {
    const onSelect = jest.fn();
    render(<SeriesScreen onSelect={onSelect} onOpenSettings={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId('series-persuasion')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('series-persuasion'));
    expect(onSelect).toHaveBeenCalledWith('persuasion');
  });

  it('allows a series with fewer than nine questions, since a round repeats to fill nine', async () => {
    await addCustom('一問だけ', 'あ');
    const onSelect = jest.fn();
    render(<SeriesScreen onSelect={onSelect} onOpenSettings={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId('series-count-custom')).toHaveTextContent('1問');
    });
    fireEvent.press(screen.getByTestId('series-custom'));
    expect(onSelect).toHaveBeenCalledWith('custom');
  });

  it('shows the stored lag for each series independently', async () => {
    await saveN('capital-call', 2);
    render(<SeriesScreen onSelect={jest.fn()} onOpenSettings={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId('series-lag-capital-call')).toHaveTextContent('2-back');
    });
    expect(screen.getByTestId('series-lag-persuasion')).toHaveTextContent('1-back');
  });

  it('opens settings', async () => {
    const onOpenSettings = jest.fn();
    render(<SeriesScreen onSelect={jest.fn()} onOpenSettings={onOpenSettings} />);
    await waitFor(() => {
      expect(screen.getByText('設定')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('設定'));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});

describe('SeriesScreen custom decks', () => {
  it('shows a created deck under its own 自分のデッキ section', async () => {
    await addCustomDeck('サブスク基礎', 'sub-finance', [{ q: 'Q', accept: ['A'] }]);
    render(<SeriesScreen onSelect={jest.fn()} onOpenSettings={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('自分のデッキ')).toBeTruthy();
    });
    expect(screen.getByText('サブスク基礎')).toBeTruthy();
  });

  it('filters the picker to the selected funds-finance category', async () => {
    await addCustomDeck('サブスクデッキ', 'sub-finance', [{ q: 'Q', accept: ['A'] }]);
    await addCustomDeck('NAVデッキ', 'nav-finance', [{ q: 'Q', accept: ['A'] }]);
    render(<SeriesScreen onSelect={jest.fn()} onOpenSettings={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('サブスクデッキ')).toBeTruthy();
    });
    expect(screen.getByText('NAVデッキ')).toBeTruthy();

    const subCategory = FUNDS_FINANCE_CATEGORIES.find((c) => c.id === 'sub-finance')!;
    fireEvent.press(screen.getByText(subCategory.nameEn.split('&')[0].trim()));

    await waitFor(() => {
      expect(screen.queryByText('NAVデッキ')).toBeNull();
    });
    expect(screen.getByText('サブスクデッキ')).toBeTruthy();
  });
});
