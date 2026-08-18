import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { addCustom, saveN } from '../../store/storage';
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
    expect(screen.getByTestId('series-count-capital-call')).toHaveTextContent('15問');
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

  it('refuses a series with fewer than nine questions and names the shortfall', async () => {
    await addCustom('一問だけ', 'あ');
    const onSelect = jest.fn();
    render(<SeriesScreen onSelect={onSelect} onOpenSettings={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/あと 8 問/)).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('series-custom'));
    expect(onSelect).not.toHaveBeenCalled();
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
