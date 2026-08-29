import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FUNDS_FINANCE_CATEGORIES } from '../content/series';
import {
  MAX_DECK_QUESTIONS,
  addCustomDeck,
  deleteCustomDeck,
  loadCustomDecks,
  updateCustomDeck,
  type CustomDeck,
} from '../store/storage';
import { useStrings } from '../strings';

interface Props {
  onClose: () => void;
}

interface QuestionDraft {
  q: string;
  answer: string;
}

const emptyDraft = (): QuestionDraft => ({ q: '', answer: '' });

export function QuestionsScreen({ onClose }: Props) {
  const [decks, setDecks] = useState<CustomDeck[]>([]);
  const strings = useStrings();

  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);
  const [deckMode, setDeckMode] = useState(false);
  const [deckTitle, setDeckTitle] = useState('');
  const [deckCategory, setDeckCategory] = useState(FUNDS_FINANCE_CATEGORIES[0].id);
  const [deckDrafts, setDeckDrafts] = useState<QuestionDraft[]>([emptyDraft()]);
  const [deckError, setDeckError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setDecks(await loadCustomDecks());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetDeckForm = () => {
    setEditingDeckId(null);
    setDeckTitle('');
    setDeckCategory(FUNDS_FINANCE_CATEGORIES[0].id);
    setDeckDrafts([emptyDraft()]);
    setDeckError(null);
  };

  const startNewDeck = () => {
    resetDeckForm();
    setDeckMode(true);
  };

  const startEditingDeck = (deck: CustomDeck) => {
    setEditingDeckId(deck.id);
    setDeckTitle(deck.title);
    setDeckCategory(deck.category);
    setDeckDrafts(
      deck.questions.map((question) => ({ q: question.q, answer: question.accept[0] ?? '' })),
    );
    setDeckError(null);
    setDeckMode(true);
  };

  const updateDeckDraft = (index: number, field: keyof QuestionDraft, value: string) => {
    setDeckDrafts((prev) =>
      prev.map((draft, i) => (i === index ? { ...draft, [field]: value } : draft)),
    );
  };

  const addDeckQuestion = () => {
    setDeckDrafts((prev) =>
      prev.length >= MAX_DECK_QUESTIONS ? prev : [...prev, emptyDraft()],
    );
  };

  const removeDeckQuestion = (index: number) => {
    setDeckDrafts((prev) => prev.filter((_, i) => i !== index));
  };

  const submitDeck = async () => {
    const title = deckTitle.trim();
    const drafts = deckDrafts
      .map((d) => ({ q: d.q.trim(), accept: [d.answer.trim()] }))
      .filter((d) => d.q && d.accept[0]);
    if (!title || drafts.length === 0) return;
    try {
      if (editingDeckId) {
        await updateCustomDeck(editingDeckId, title, deckCategory, drafts);
      } else {
        await addCustomDeck(title, deckCategory, drafts);
      }
      resetDeckForm();
      setDeckMode(false);
      await refresh();
    } catch (e) {
      setDeckError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeDeck = async () => {
    if (!editingDeckId) return;
    await deleteCustomDeck(editingDeckId);
    resetDeckForm();
    setDeckMode(false);
    await refresh();
  };

  if (deckMode) {
    return (
      <View style={styles.screen}>
        <Text style={styles.heading}>
          {editingDeckId ? strings.questions.editDeck : strings.questions.newDeck}
        </Text>

        <TextInput
          style={styles.input}
          placeholder={strings.questions.deckNamePlaceholder}
          placeholderTextColor="#8e8e93"
          value={deckTitle}
          onChangeText={setDeckTitle}
        />

        <View style={styles.categoryRow}>
          {FUNDS_FINANCE_CATEGORIES.map((cat) => (
            <Pressable
              key={cat.id}
              style={[
                styles.categoryChip,
                deckCategory === cat.id && styles.categoryChipActive,
              ]}
              onPress={() => setDeckCategory(cat.id)}
            >
              <Text style={styles.label}>{cat.name}</Text>
            </Pressable>
          ))}
        </View>

        <ScrollView style={styles.list}>
          {deckDrafts.map((draft, index) => (
            <View key={index} style={styles.item}>
              <TextInput
                style={styles.input}
                placeholder={strings.questions.placeholderQuestion}
                placeholderTextColor="#8e8e93"
                value={draft.q}
                onChangeText={(text) => updateDeckDraft(index, 'q', text)}
              />
              <TextInput
                style={styles.input}
                placeholder={strings.questions.placeholderAnswer}
                placeholderTextColor="#8e8e93"
                value={draft.answer}
                onChangeText={(text) => updateDeckDraft(index, 'answer', text)}
              />
              {deckDrafts.length > 1 && (
                <Pressable onPress={() => removeDeckQuestion(index)}>
                  <Text style={styles.itemA}>{strings.questions.removeQuestion}</Text>
                </Pressable>
              )}
            </View>
          ))}
        </ScrollView>

        {deckDrafts.length < MAX_DECK_QUESTIONS && (
          <Pressable style={styles.secondary} onPress={addDeckQuestion}>
            <Text style={styles.label}>{strings.questions.addQuestion}</Text>
          </Pressable>
        )}

        {deckError && <Text style={styles.itemA}>{deckError}</Text>}

        <View style={styles.formRow}>
          <Pressable style={styles.primary} onPress={() => void submitDeck()}>
            <Text style={styles.label}>{strings.questions.saveDeck}</Text>
          </Pressable>
          {editingDeckId && (
            <Pressable style={styles.secondary} onPress={() => void removeDeck()}>
              <Text style={styles.label}>{strings.questions.delete}</Text>
            </Pressable>
          )}
          <Pressable
            style={styles.secondary}
            onPress={() => {
              resetDeckForm();
              setDeckMode(false);
            }}
          >
            <Text style={styles.label}>{strings.questions.cancel}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>{strings.questions.heading}</Text>
      <Text style={styles.count}>{strings.questions.count(decks.length)}</Text>

      <Pressable style={styles.primary} onPress={startNewDeck}>
        <Text style={styles.label}>{strings.questions.newDeck}</Text>
      </Pressable>

      <ScrollView style={styles.list}>
        {decks.length === 0 && <Text style={styles.itemA}>{strings.questions.noDecks}</Text>}
        {decks.map((deck) => (
          <Pressable
            key={deck.id}
            style={styles.item}
            onPress={() => startEditingDeck(deck)}
          >
            <Text style={styles.itemQ}>{deck.title}</Text>
            <Text style={styles.itemA}>{strings.questions.count(deck.questions.length)}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Pressable style={styles.secondary} onPress={onClose}>
        <Text style={styles.label}>{strings.common.close}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, paddingTop: 80, backgroundColor: '#000' },
  heading: { color: '#f4f1ea', fontSize: 28, marginBottom: 4 },
  count: { color: '#8e8e93', fontSize: 14, marginBottom: 20 },
  input: {
    backgroundColor: '#1c1c1e',
    color: '#f4f1ea',
    fontSize: 16,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  formRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  primary: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: '#c96f4a',
    alignItems: 'center',
    marginBottom: 20,
  },
  secondary: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: '#1c1c1e',
    alignItems: 'center',
  },
  label: { color: '#f4f1ea', fontSize: 16 },
  list: { flex: 1, marginBottom: 16 },
  item: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  itemQ: { color: '#f4f1ea', fontSize: 16 },
  itemA: { color: '#8e8e93', fontSize: 14, marginTop: 2 },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  categoryChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#1c1c1e',
  },
  categoryChipActive: { backgroundColor: '#c96f4a' },
});
