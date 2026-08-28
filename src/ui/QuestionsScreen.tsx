import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Question } from '../engine/types';
import {
  addCustom,
  deleteCustom,
  loadCustom,
  updateCustom,
} from '../store/storage';
import { useStrings } from '../strings';

interface Props {
  onClose: () => void;
}

export function QuestionsScreen({ onClose }: Props) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftQ, setDraftQ] = useState('');
  const [draftAnswer, setDraftAnswer] = useState('');
  const strings = useStrings();

  const refresh = useCallback(async () => {
    setQuestions(await loadCustom());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetForm = () => {
    setEditingId(null);
    setDraftQ('');
    setDraftAnswer('');
  };

  const submit = async () => {
    const q = draftQ.trim();
    const answer = draftAnswer.trim();
    if (!q || !answer) return;
    if (editingId) {
      await updateCustom(editingId, q, answer);
    } else {
      await addCustom(q, answer);
    }
    resetForm();
    await refresh();
  };

  const startEditing = (question: Question) => {
    setEditingId(question.id);
    setDraftQ(question.q);
    setDraftAnswer(question.accept[0] ?? '');
  };

  const remove = async () => {
    if (!editingId) return;
    await deleteCustom(editingId);
    resetForm();
    await refresh();
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>{strings.questions.heading}</Text>
      <Text style={styles.count}>{strings.questions.count(questions.length)}</Text>

      <TextInput
        style={styles.input}
        placeholder={strings.questions.placeholderQuestion}
        placeholderTextColor="#8e8e93"
        value={draftQ}
        onChangeText={setDraftQ}
      />
      <TextInput
        style={styles.input}
        placeholder={strings.questions.placeholderAnswer}
        placeholderTextColor="#8e8e93"
        value={draftAnswer}
        onChangeText={setDraftAnswer}
      />

      <View style={styles.formRow}>
        <Pressable style={styles.primary} onPress={() => void submit()}>
          <Text style={styles.label}>{editingId ? strings.questions.save : strings.questions.add}</Text>
        </Pressable>
        {editingId && (
          <>
            <Pressable style={styles.secondary} onPress={() => void remove()}>
              <Text style={styles.label}>{strings.questions.delete}</Text>
            </Pressable>
            <Pressable style={styles.secondary} onPress={resetForm}>
              <Text style={styles.label}>{strings.questions.cancel}</Text>
            </Pressable>
          </>
        )}
      </View>

      <ScrollView style={styles.list}>
        {questions.map((question) => (
          <Pressable
            key={question.id}
            style={styles.item}
            onPress={() => startEditing(question)}
          >
            <Text style={styles.itemQ}>{question.q}</Text>
            <Text style={styles.itemA}>{question.accept[0]}</Text>
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
});
