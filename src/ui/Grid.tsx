import { Pressable, StyleSheet, View } from 'react-native';
import type { PositionOutcome } from '../engine/round';
import type { Position } from '../engine/types';

interface Props {
  flashPosition: Position | null;
  selected: Position | null;
  /** How the current tap scored. null on steps that recall nothing. */
  tapVerdict?: PositionOutcome | null;
  onTap: (position: Position) => void;
  disabled?: boolean;
  /**
   * The square the grid must fit inside. Defaults to the original 300. With a
   * keyboard up there is far less height than width, so the caller passes
   * min(width, height) and the cells follow.
   */
  size?: number;
}

export function Grid({
  flashPosition,
  selected,
  tapVerdict,
  onTap,
  disabled,
  size = 300,
}: Props) {
  const ring =
    tapVerdict === 'correct'
      ? styles.ringCorrect
      : tapVerdict === 'wrong'
        ? styles.ringWrong
        : null;
  const cell = Math.floor(size / 3) - 4;
  return (
    <View style={[styles.grid, { width: size, height: size }]}>
      {Array.from({ length: 9 }, (_, i) => (
        <Pressable
          key={i}
          testID={`cell-${i}`}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ selected: flashPosition === i, disabled }}
          accessibilityLabel={
            selected === i ? `マス${i + 1} 選択中` : `マス${i + 1}`
          }
          onPress={() => onTap(i)}
          style={[
            styles.cell,
            { width: cell, height: cell },
            flashPosition === i && styles.flash,
            selected === i && styles.selected,
            selected === i && ring,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignSelf: 'center',
  },
  cell: {
    margin: 2,
    backgroundColor: '#1c1c1e',
    borderRadius: 8,
  },
  flash: { backgroundColor: '#f4f1ea' },
  selected: { borderWidth: 3, borderColor: '#c96f4a' },
  ringCorrect: { borderColor: '#4caf7d' },
  ringWrong: { borderColor: '#e5534b' },
});
