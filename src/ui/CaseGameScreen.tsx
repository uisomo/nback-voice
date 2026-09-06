import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { getCase, type SheetGroup } from '../cases/cases';
import {
  advance,
  currentTurn,
  initState,
  reveal,
  replay,
  setGuess,
  startConversation,
  type GameState,
} from '../cases/reducer';
import { useStrings } from '../strings';
import { getTheme } from './theme';

const GROUP_ORDER: SheetGroup[] = ['terms', 'collateral', 'investors', 'legal', 'risk'];

export function CaseGameScreen({ caseId, onExit }: { caseId: string; onExit: () => void }) {
  const strings = useStrings();
  const theme = getTheme();
  const loanCase = getCase(caseId);
  const [state, setState] = useState<GameState>(initState());
  const [memoOpen, setMemoOpen] = useState(false);

  if (!loanCase) {
    return (
      <View style={[styles.root, { backgroundColor: theme.bg }]}>
        <Pressable testID="case-back" onPress={onExit}>
          <Text style={{ color: theme.textPrimary }}>{strings.cases.backToList}</Text>
        </Pressable>
      </View>
    );
  }

  const total = loanCase.conversation.length;
  const turn = currentTurn(loanCase, state);
  const priorTurns = loanCase.conversation.slice(0, state.turnIndex);

  const Sheet = () => (
    <View>
      {GROUP_ORDER.map((g) => {
        const fields = loanCase.sheet.filter((f) => f.group === g);
        if (fields.length === 0) return null;
        return (
          <View key={g} style={styles.sheetGroup}>
            <Text style={[styles.sheetGroupLabel, { color: theme.accentGold }]}>{g}</Text>
            {fields.map((f, i) => (
              <View key={i} style={styles.sheetRow}>
                <Text style={[styles.sheetLabel, { color: theme.textMuted }]}>{f.label}</Text>
                <Text style={[styles.sheetValue, { color: theme.textPrimary }]}>{f.value}</Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );

  return (
    <ScrollView style={[styles.root, { backgroundColor: theme.bg }]} contentContainerStyle={styles.content}>
      {state.phase === 'sheet' && (
        <>
          <Text style={[styles.title, { color: theme.textPrimary }]}>{loanCase.title}</Text>
          <Text style={[styles.credit, { color: theme.textMuted }]}>{loanCase.credit}</Text>
          <Sheet />
          <Pressable
            testID="case-start"
            onPress={() => setState(startConversation(state))}
            style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
          >
            <Text style={styles.primaryBtnText}>{strings.cases.start}</Text>
          </Pressable>
        </>
      )}

      {state.phase === 'conversation' && turn && (
        <>
          {/* peek panel */}
          <Pressable testID="case-memo-toggle" onPress={() => setMemoOpen((o) => !o)}>
            <Text style={[styles.memoToggle, { color: theme.accentGold }]}>{strings.cases.memo}</Text>
          </Pressable>
          {memoOpen && <Sheet />}

          {/* conversation so far */}
          {priorTurns.map((t, i) => (
            <View key={i} style={styles.priorTurn}>
              <Text style={[styles.speaker, { color: theme.textMuted }]}>{t.speaker}</Text>
              <Text style={[styles.priorLine, { color: theme.textPrimary }]}>{t.line}</Text>
            </View>
          ))}

          {/* current turn */}
          <Text style={[styles.turnCounter, { color: theme.textMuted }]}>
            {strings.cases.turnCounter(state.turnIndex + 1, total)}
          </Text>
          <Text style={[styles.speaker, { color: theme.accentGold }]}>{turn.speaker}</Text>

          <TextInput
            testID="case-guess-input"
            value={state.guess}
            onChangeText={(text) => setState(setGuess(state, text))}
            placeholder={strings.cases.guessPlaceholder}
            placeholderTextColor={theme.textMuted}
            editable={!state.revealed}
            multiline
            style={[styles.input, { color: theme.textPrimary, borderColor: theme.cardBorder }]}
          />

          {!state.revealed ? (
            <Pressable
              testID="case-reveal"
              onPress={() => setState(reveal(state))}
              style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
            >
              <Text style={styles.primaryBtnText}>{strings.cases.reveal}</Text>
            </Pressable>
          ) : (
            <>
              {state.guess.trim() !== '' && (
                <View style={styles.revealBlock}>
                  <Text style={[styles.revealLabel, { color: theme.textMuted }]}>{strings.cases.yourGuess}</Text>
                  <Text testID="case-your-guess" style={[styles.guessLine, { color: theme.textMuted }]}>
                    {state.guess}
                  </Text>
                </View>
              )}
              <View style={styles.revealBlock}>
                <Text testID="case-real-line" style={[styles.realLine, { color: theme.textPrimary }]}>
                  {turn.line}
                </Text>
                {turn.note && <Text style={[styles.note, { color: theme.textMuted }]}>{turn.note}</Text>}
              </View>
              <Pressable
                testID="case-next"
                onPress={() => setState(advance(state, total))}
                style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
              >
                <Text style={styles.primaryBtnText}>{strings.cases.next}</Text>
              </Pressable>
            </>
          )}
        </>
      )}

      {state.phase === 'done' && (
        <View style={styles.endCard}>
          <Text testID="case-approved" style={[styles.approved, { color: theme.accentGold }]}>
            {strings.cases.approved}
          </Text>
          <Pressable
            testID="case-again"
            onPress={() => setState(replay())}
            style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
          >
            <Text style={styles.primaryBtnText}>{strings.cases.again}</Text>
          </Pressable>
          <Pressable testID="case-back" onPress={onExit} style={styles.secondaryBtn}>
            <Text style={[styles.secondaryBtnText, { color: theme.textPrimary }]}>{strings.cases.backToList}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16 },
  title: { fontSize: 18, fontWeight: 'bold' },
  credit: { fontSize: 12, marginTop: 4, marginBottom: 12 },
  sheetGroup: { marginBottom: 14 },
  sheetGroupLabel: { fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 6 },
  sheetRow: { marginBottom: 6 },
  sheetLabel: { fontSize: 11 },
  sheetValue: { fontSize: 14 },
  primaryBtn: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 16 },
  primaryBtnText: { color: '#050810', fontWeight: 'bold', fontSize: 15 },
  secondaryBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  secondaryBtnText: { fontSize: 14 },
  memoToggle: { fontSize: 12, fontWeight: '600', marginBottom: 8 },
  priorTurn: { marginBottom: 10, opacity: 0.7 },
  speaker: { fontSize: 12, fontWeight: '600', marginBottom: 2 },
  priorLine: { fontSize: 14 },
  turnCounter: { fontSize: 11, marginTop: 12 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, minHeight: 48, marginTop: 6, fontSize: 14 },
  revealBlock: { marginTop: 12 },
  revealLabel: { fontSize: 11, marginBottom: 2 },
  guessLine: { fontSize: 14, fontStyle: 'italic' },
  realLine: { fontSize: 15, fontWeight: '500' },
  note: { fontSize: 12, marginTop: 6 },
  endCard: { alignItems: 'center', paddingTop: 40 },
  approved: { fontSize: 28, fontWeight: 'bold', letterSpacing: 4 },
});
