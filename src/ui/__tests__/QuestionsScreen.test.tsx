import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FUNDS_FINANCE_CATEGORIES } from '../../content/series';
import { addCustomDeck, loadCustomDecks } from '../../store/storage';
import { QuestionsScreen } from '../QuestionsScreen';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('QuestionsScreen', () => {
  it('has no single-question quick-add form', async () => {
    const { queryByPlaceholderText, queryByText } = render(
      <QuestionsScreen onClose={() => {}} />,
    );
    await waitFor(() => {});
    expect(queryByPlaceholderText('問題')).toBeNull();
    expect(queryByPlaceholderText('答え')).toBeNull();
    expect(queryByText('追加')).toBeNull();
  });

  it('offers a button to start a new deck', async () => {
    const { getByText } = render(<QuestionsScreen onClose={() => {}} />);
    await waitFor(() => {});
    expect(getByText('新しいデッキ')).toBeTruthy();
  });

  it('lists decks created in the past', async () => {
    await addCustomDeck('過去のデッキ', 'sub-finance', [{ q: 'Q', accept: ['A'] }]);
    const { findByText } = render(<QuestionsScreen onClose={() => {}} />);
    expect(await findByText('過去のデッキ')).toBeTruthy();
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

  it('returns to the deck list on cancel', async () => {
    const { getByText, queryByText } = render(<QuestionsScreen onClose={() => {}} />);
    await waitFor(() => {});
    fireEvent.press(getByText('新しいデッキ'));
    fireEvent.press(getByText('取消'));
    expect(queryByText('質問を追加')).toBeNull();
    expect(getByText('新しいデッキ')).toBeTruthy();
  });
});

describe('QuestionsScreen editing a past deck', () => {
  it('opens a tapped deck pre-filled for editing', async () => {
    await addCustomDeck('編集対象', 'sub-finance', [{ q: '元の問題', accept: ['元の答え'] }]);
    const { findByText, getByPlaceholderText, getByDisplayValue } = render(
      <QuestionsScreen onClose={() => {}} />,
    );
    fireEvent.press(await findByText('編集対象'));
    expect(getByPlaceholderText('デッキ名')).toHaveProp('value', '編集対象');
    expect(getByDisplayValue('元の問題')).toBeTruthy();
    expect(getByDisplayValue('元の答え')).toBeTruthy();
  });

  it('saves edits back to the same deck', async () => {
    const created = await addCustomDeck('編集対象', 'sub-finance', [
      { q: '元の問題', accept: ['元の答え'] },
    ]);
    const { findByText, getByPlaceholderText, getByText } = render(
      <QuestionsScreen onClose={() => {}} />,
    );
    fireEvent.press(await findByText('編集対象'));
    fireEvent.changeText(getByPlaceholderText('デッキ名'), '直したデッキ');
    fireEvent.press(getByText('デッキを保存'));

    await waitFor(async () => {
      const decks = await loadCustomDecks();
      expect(decks).toHaveLength(1);
      expect(decks[0].id).toBe(created.id);
      expect(decks[0].title).toBe('直したデッキ');
    });
  });

  it('deletes the deck being edited', async () => {
    await addCustomDeck('消えるデッキ', 'sub-finance', [{ q: 'Q', accept: ['A'] }]);
    const { findByText, getByText } = render(<QuestionsScreen onClose={() => {}} />);
    fireEvent.press(await findByText('消えるデッキ'));
    fireEvent.press(getByText('削除'));
    await waitFor(async () => {
      expect(await loadCustomDecks()).toHaveLength(0);
    });
  });
});
