import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderHook, waitFor } from '@testing-library/react-native';
import { saveSettings, DEFAULT_SETTINGS } from '../../store/storage';
import { ja, en, useStrings } from '../index';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('ja/en table shape parity', () => {
  function keys(obj: unknown, prefix = ''): string[] {
    if (typeof obj === 'function') return [prefix];
    if (typeof obj !== 'object' || obj === null) return [prefix];
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      keys(v, prefix ? `${prefix}.${k}` : k),
    );
  }

  it('has an identical key set in ja and en', () => {
    expect(keys(ja).sort()).toEqual(keys(en).sort());
  });

  it('has the same value type (string vs function) at every key', () => {
    function types(obj: unknown, prefix = ''): Record<string, string> {
      if (typeof obj !== 'object' || obj === null) return { [prefix]: typeof obj };
      return Object.assign(
        {},
        ...Object.entries(obj as Record<string, unknown>).map(([k, v]) =>
          types(v, prefix ? `${prefix}.${k}` : k),
        ),
      );
    }
    expect(types(ja)).toEqual(types(en));
  });
});

describe('useStrings', () => {
  it('resolves to ja before settings load and stays ja by default', async () => {
    const { result } = renderHook(() => useStrings());
    expect(result.current).toBe(ja);
    await waitFor(() => expect(result.current).toBe(ja));
  });

  it('resolves to en once language: en is stored', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, language: 'en' });
    const { result } = renderHook(() => useStrings());
    await waitFor(() => expect(result.current).toBe(en));
  });
});
