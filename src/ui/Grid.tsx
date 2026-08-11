import { Pressable, StyleSheet, View } from 'react-native';
import type { Position } from '../engine/types';

interface Props {
  flashPosition: Position | null;
  selected: Position | null;
  onTap: (position: Position) => void;
  disabled?: boolean;
}

export function Grid({ flashPosition, selected, onTap, disabled }: Props) {
  return (
    <View style={styles.grid}>
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
            flashPosition === i && styles.flash,
            selected === i && styles.selected,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    width: 300,
    height: 300,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignSelf: 'center',
  },
  cell: {
    width: 96,
    height: 96,
    margin: 2,
    backgroundColor: '#1c1c1e',
    borderRadius: 8,
  },
  flash: { backgroundColor: '#f4f1ea' },
  selected: { borderWidth: 3, borderColor: '#c96f4a' },
});
