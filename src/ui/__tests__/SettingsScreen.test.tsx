import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { loadSettings } from '../../store/storage';
import { SettingsScreen } from '../SettingsScreen';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('SettingsScreen', () => {
  it('persists a new step duration', async () => {
    const { getByText } = render(<SettingsScreen onClose={() => {}} />);
    fireEvent.press(getByText('8秒'));
    await waitFor(async () => {
      expect((await loadSettings()).stepDurationMs).toBe(8000);
    });
  });

  it('persists the difficulty tier', async () => {
    const { getByText } = render(<SettingsScreen onClose={() => {}} />);
    fireEvent.press(getByText('やさしい'));
    await waitFor(async () => {
      expect((await loadSettings()).maxTier).toBe(1);
    });
  });

  it('hides the fixed-N picker while adaptive is on', async () => {
    const { queryByText } = render(<SettingsScreen onClose={() => {}} />);
    await waitFor(() => {});
    expect(queryByText('Nを自動調整')).toBeTruthy();
    expect(queryByText('5')).toBeNull();
  });

  it('reveals the fixed-N picker when adaptive is turned off', async () => {
    const { getByRole, findByText } = render(<SettingsScreen onClose={() => {}} />);
    await waitFor(() => {});
    fireEvent(getByRole('switch'), 'valueChange', false);
    expect(await findByText('5')).toBeTruthy();
  });

  it('fires onClose', async () => {
    const onClose = jest.fn();
    const { getByText } = render(<SettingsScreen onClose={onClose} />);
    await waitFor(() => {});
    fireEvent.press(getByText('閉じる'));
    expect(onClose).toHaveBeenCalled();
  });
});
