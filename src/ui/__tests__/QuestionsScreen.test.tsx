import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { addCustom, loadCustom } from '../../store/storage';
import { QuestionsScreen } from '../QuestionsScreen';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('QuestionsScreen', () => {
  it('shows a count of zero when there are no questions', async () => {
    const { findByText } = render(<QuestionsScreen onClose={() => {}} />);
    expect(await findByText(/0 問/)).toBeTruthy();
  });

  it('lists existing questions', async () => {
    await addCustom('犬の鳴き声は？', 'わん');
    const { findByText } = render(<QuestionsScreen onClose={() => {}} />);
    expect(await findByText('犬の鳴き声は？')).toBeTruthy();
  });

  it('adds a question and persists it', async () => {
    const { getByPlaceholderText, getByText } = render(
      <QuestionsScreen onClose={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent.changeText(getByPlaceholderText('問題'), '猫の鳴き声は？');
    fireEvent.changeText(getByPlaceholderText('答え'), 'にゃー');
    fireEvent.press(getByText('追加'));
    await waitFor(async () => {
      const stored = await loadCustom();
      expect(stored).toHaveLength(1);
      expect(stored[0].q).toBe('猫の鳴き声は？');
      expect(stored[0].accept).toEqual(['にゃー']);
    });
  });

  it('refuses to add when either field is empty', async () => {
    const { getByPlaceholderText, getByText } = render(
      <QuestionsScreen onClose={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent.changeText(getByPlaceholderText('問題'), '問題だけ');
    fireEvent.press(getByText('追加'));
    await waitFor(() => {});
    expect(await loadCustom()).toHaveLength(0);
  });

  it('clears the form after a successful add', async () => {
    const { getByPlaceholderText, getByText } = render(
      <QuestionsScreen onClose={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent.changeText(getByPlaceholderText('問題'), '猫の鳴き声は？');
    fireEvent.changeText(getByPlaceholderText('答え'), 'にゃー');
    fireEvent.press(getByText('追加'));
    await waitFor(() => {
      expect(getByPlaceholderText('問題').props.value).toBe('');
    });
  });

  it('edits an existing question', async () => {
    const created = await addCustom('元の問題', 'もと');
    const { findByText, getByPlaceholderText, getByText } = render(
      <QuestionsScreen onClose={() => {}} />,
    );
    fireEvent.press(await findByText('元の問題'));
    fireEvent.changeText(getByPlaceholderText('問題'), '直した問題');
    fireEvent.changeText(getByPlaceholderText('答え'), 'なおした');
    fireEvent.press(getByText('保存'));
    await waitFor(async () => {
      const [stored] = await loadCustom();
      expect(stored.id).toBe(created.id);
      expect(stored.q).toBe('直した問題');
    });
  });

  it('deletes a question', async () => {
    await addCustom('消える問題', 'あ');
    const { findByText, getByText } = render(
      <QuestionsScreen onClose={() => {}} />,
    );
    fireEvent.press(await findByText('消える問題'));
    fireEvent.press(getByText('削除'));
    await waitFor(async () => {
      expect(await loadCustom()).toHaveLength(0);
    });
  });

  it('fires onClose', async () => {
    const onClose = jest.fn();
    const { getByText } = render(<QuestionsScreen onClose={onClose} />);
    await waitFor(() => {});
    fireEvent.press(getByText('閉じる'));
    expect(onClose).toHaveBeenCalled();
  });
});
