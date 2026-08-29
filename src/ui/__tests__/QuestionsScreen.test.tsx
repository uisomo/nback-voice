import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FUNDS_FINANCE_CATEGORIES } from '../../content/series';
import { addCustom, loadCustom, loadCustomDecks } from '../../store/storage';
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

describe('QuestionsScreen deck builder', () => {
  it('offers a mode switch into deck building', async () => {
    const { getByText } = render(<QuestionsScreen onClose={() => {}} />);
    await waitFor(() => {});
    expect(getByText('新しいデッキ')).toBeTruthy();
  });

  it('lists only the fixed funds-finance categories, not a free-text field', async () => {
    const { getByText, queryByPlaceholderText } = render(
      <QuestionsScreen onClose={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent.press(getByText('新しいデッキ'));
    for (const cat of FUNDS_FINANCE_CATEGORIES) {
      expect(getByText(cat.name)).toBeTruthy();
    }
    expect(queryByPlaceholderText('カテゴリー')).toBeNull();
  });

  it('creates a deck with multiple questions under the chosen category', async () => {
    const { getByText, getByPlaceholderText, getAllByPlaceholderText } = render(
      <QuestionsScreen onClose={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent.press(getByText('新しいデッキ'));

    fireEvent.changeText(getByPlaceholderText('デッキ名'), 'テストデッキ');
    fireEvent.press(getByText(FUNDS_FINANCE_CATEGORIES[0].name));

    fireEvent.changeText(getAllByPlaceholderText('問題')[0], '問1');
    fireEvent.changeText(getAllByPlaceholderText('答え')[0], '答1');

    fireEvent.press(getByText('質問を追加'));
    fireEvent.changeText(getAllByPlaceholderText('問題')[1], '問2');
    fireEvent.changeText(getAllByPlaceholderText('答え')[1], '答2');

    fireEvent.press(getByText('デッキを保存'));

    await waitFor(async () => {
      const decks = await loadCustomDecks();
      expect(decks).toHaveLength(1);
      expect(decks[0].title).toBe('テストデッキ');
      expect(decks[0].category).toBe(FUNDS_FINANCE_CATEGORIES[0].id);
      expect(decks[0].questions.map((q) => q.q)).toEqual(['問1', '問2']);
    });
  });

  it('stops offering more questions at 10', async () => {
    const { getByText, queryByText } = render(<QuestionsScreen onClose={() => {}} />);
    await waitFor(() => {});
    fireEvent.press(getByText('新しいデッキ'));
    for (let i = 0; i < 9; i++) {
      fireEvent.press(getByText('質問を追加'));
    }
    expect(queryByText('質問を追加')).toBeNull();
  });
});
