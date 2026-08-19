import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { addCustom, loadApiKey, loadSettings } from '../../store/storage';
import type { JudgeClient } from '../../judge/types';
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

describe('SettingsScreen after series', () => {
  it('no longer offers a question-source toggle', async () => {
    const { queryByTestId } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
    );
    await waitFor(() => {});
    expect(queryByTestId('source-builtin')).toBeNull();
    expect(queryByTestId('source-custom')).toBeNull();
    expect(queryByTestId('source-both')).toBeNull();
  });

  it('says the difficulty chips govern the standard series only', async () => {
    const { findByText } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
    );
    expect(await findByText('標準問題のむずかしさ')).toBeTruthy();
  });
});

describe('SettingsScreen API key', () => {
  const ok: JudgeClient = {
    judge: async () => ({ correct: true, matched: 'わん' }),
  };

  it('shows 未設定 when no key is stored', async () => {
    const { findByText } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
    );
    expect(await findByText(/未設定/)).toBeTruthy();
  });

  it('saves a pasted key and shows it masked, never in full', async () => {
    const { getByTestId, findByText, queryByText } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent.changeText(getByTestId('api-key-input'), 'sk-ant-abcdefghijkl9876');
    await waitFor(async () => {
      expect(await loadApiKey()).toBe('sk-ant-abcdefghijkl9876');
    });
    expect(await findByText(/9876/)).toBeTruthy();
    expect(queryByText('sk-ant-abcdefghijkl9876')).toBeNull();
  });

  it('reports success when the key works', async () => {
    const { getByText, findByText } = render(
      <SettingsScreen
        onClose={() => {}}
        onEditQuestions={() => {}}
        judgeClient={ok}
      />,
    );
    await waitFor(() => {});
    fireEvent.press(getByText('接続を確認'));
    expect(await findByText(/確認できました/)).toBeTruthy();
  });

  it('surfaces the failure instead of letting it become a silent 未判定', async () => {
    // A wrong key 401s, which the judge queue turns into 未判定 — invisible.
    // This button is the only place that failure is ever stated on screen.
    const broken: JudgeClient = {
      judge: async () => {
        throw new Error('401 authentication_error');
      },
    };
    const { getByText, findByText } = render(
      <SettingsScreen
        onClose={() => {}}
        onEditQuestions={() => {}}
        judgeClient={broken}
      />,
    );
    await waitFor(() => {});
    fireEvent.press(getByText('接続を確認'));
    expect(await findByText(/401/)).toBeTruthy();
  });
});
