import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { addCustom, loadSettings } from '../../store/storage';
import { SettingsScreen } from '../SettingsScreen';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('SettingsScreen', () => {
  it('persists a new step duration', async () => {
    const { getByText } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
    );
    fireEvent.press(getByText('8秒'));
    await waitFor(async () => {
      expect((await loadSettings()).stepDurationMs).toBe(8000);
    });
  });

  it('persists the difficulty tier', async () => {
    const { getByText } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
    );
    fireEvent.press(getByText('やさしい'));
    await waitFor(async () => {
      expect((await loadSettings()).maxTier).toBe(1);
    });
  });

  it('hides the fixed-N picker while adaptive is on', async () => {
    const { queryByText } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
    );
    await waitFor(() => {});
    expect(queryByText('Nを自動調整')).toBeTruthy();
    expect(queryByText('5')).toBeNull();
  });

  it('reveals the fixed-N picker when adaptive is turned off', async () => {
    const { getByRole, findByText } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent(getByRole('switch'), 'valueChange', false);
    expect(await findByText('5')).toBeTruthy();
  });

  it('fires onClose', async () => {
    const onClose = jest.fn();
    const { getByText } = render(
      <SettingsScreen onClose={onClose} onEditQuestions={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent.press(getByText('閉じる'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('SettingsScreen mode selector', () => {
  it('persists question-only mode', async () => {
    const { getByText } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent.press(getByText('質問のみ'));
    await waitFor(async () => {
      expect((await loadSettings()).mode).toBe('question');
    });
  });

  it('persists a return to dual mode', async () => {
    const { getByText } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent.press(getByText('質問のみ'));
    fireEvent.press(getByText('位置＋質問'));
    await waitFor(async () => {
      expect((await loadSettings()).mode).toBe('dual');
    });
  });
});

describe('SettingsScreen question source', () => {
  // Query the source chips by testID, not by text: the label 自分の問題 also
  // appears in the 自分の問題を編集 link, and a text query would match both
  // and throw on the ambiguity.
  it('shows the shortfall and refuses "自分の問題" below nine', async () => {
    await addCustom('一問だけ', 'あ');
    const { findByText, getByTestId } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
    );
    expect(await findByText(/あと 8 問/)).toBeTruthy();
    fireEvent.press(getByTestId('source-custom'));
    await waitFor(() => {});
    // Still the default — the disabled option must not have been applied.
    expect((await loadSettings()).questionSource).toBe('builtin');
  });

  it('allows "自分の問題" once there are nine', async () => {
    for (let i = 0; i < 9; i++) await addCustom(`問題${i}`, `答え${i}`);
    const { getByTestId } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent.press(getByTestId('source-custom'));
    await waitFor(async () => {
      expect((await loadSettings()).questionSource).toBe('custom');
    });
  });

  it('always allows "両方"', async () => {
    const { getByTestId } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent.press(getByTestId('source-both'));
    await waitFor(async () => {
      expect((await loadSettings()).questionSource).toBe('both');
    });
  });

  it('opens the question editor', async () => {
    const onEditQuestions = jest.fn();
    const { getByText } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={onEditQuestions} />,
    );
    await waitFor(() => {});
    fireEvent.press(getByText('自分の問題を編集'));
    expect(onEditQuestions).toHaveBeenCalled();
  });
});
