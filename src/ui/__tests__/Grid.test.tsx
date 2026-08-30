import { StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { Grid } from '../Grid';

describe('Grid', () => {
  it('renders 9 cells', () => {
    const { getByTestId } = render(
      <Grid flashPosition={null} selected={null} onTap={() => {}} />,
    );
    for (let i = 0; i < 9; i++) {
      expect(getByTestId(`cell-${i}`)).toBeTruthy();
    }
  });

  it('reports the tapped position', () => {
    const onTap = jest.fn();
    const { getByTestId } = render(
      <Grid flashPosition={null} selected={null} onTap={onTap} />,
    );
    fireEvent.press(getByTestId('cell-4'));
    expect(onTap).toHaveBeenCalledWith(4);
  });

  it('does not report taps while disabled', () => {
    const onTap = jest.fn();
    const { getByTestId } = render(
      <Grid flashPosition={null} selected={null} onTap={onTap} disabled />,
    );
    fireEvent.press(getByTestId('cell-4'));
    expect(onTap).not.toHaveBeenCalled();
  });

  it('marks the flashing cell', () => {
    const { getByTestId } = render(
      <Grid flashPosition={3} selected={null} onTap={() => {}} />,
    );
    expect(getByTestId('cell-3').props.accessibilityState.selected).toBe(true);
    expect(getByTestId('cell-2').props.accessibilityState.selected).toBe(false);
  });

  it('marks the selected cell distinctly from the flashing one', () => {
    const { getByTestId } = render(
      <Grid flashPosition={null} selected={7} onTap={() => {}} />,
    );
    expect(getByTestId('cell-7').props.accessibilityLabel).toContain('選択');
  });
});

/** The border a cell actually renders with, whatever the style shape. */
function borderOf(node: { props: { style?: StyleProp<ViewStyle> } }): unknown {
  return StyleSheet.flatten(node.props.style)?.borderColor;
}

const CORRECT = '#4caf7d';
const WRONG = '#e5534b';
const PENDING = '#c96f4a';

describe('Grid tap verdict', () => {
  it('rings the tapped cell green when the tap was right', () => {
    const { getByTestId } = render(
      <Grid
        flashPosition={null}
        selected={7}
        tapVerdict="correct"
        onTap={() => {}}
      />,
    );
    expect(borderOf(getByTestId('cell-7'))).toBe(CORRECT);
  });

  it('rings it red when the tap was wrong', () => {
    const { getByTestId } = render(
      <Grid
        flashPosition={null}
        selected={7}
        tapVerdict="wrong"
        onTap={() => {}}
      />,
    );
    expect(borderOf(getByTestId('cell-7'))).toBe(WRONG);
  });

  it('keeps the neutral ring when there is nothing to score yet', () => {
    // The first N steps recall nothing, so a tap there is neither right nor
    // wrong — colouring it either way would be a lie.
    const { getByTestId } = render(
      <Grid
        flashPosition={null}
        selected={7}
        tapVerdict={null}
        onTap={() => {}}
      />,
    );
    expect(borderOf(getByTestId('cell-7'))).toBe(PENDING);
  });

  it('leaves untapped cells alone', () => {
    const { getByTestId } = render(
      <Grid
        flashPosition={null}
        selected={7}
        tapVerdict="correct"
        onTap={() => {}}
      />,
    );
    expect(borderOf(getByTestId('cell-2'))).toBeUndefined();
  });
});

describe('Grid sizing', () => {
  /** The flattened width of one cell, whatever the style shape. */
  function cellWidth(node: { props: { style?: StyleProp<ViewStyle> } }): unknown {
    return StyleSheet.flatten(node.props.style)?.width;
  }

  it('keeps its 96px cells when no size is given', () => {
    const { getByTestId } = render(
      <Grid flashPosition={null} selected={null} onTap={() => {}} />,
    );
    expect(cellWidth(getByTestId('cell-0'))).toBe(96);
  });

  it('shrinks its cells to the size it is handed', () => {
    const { getByTestId } = render(
      <Grid flashPosition={null} selected={null} onTap={() => {}} size={200} />,
    );
    // 200 / 3 = 66, less the 2px margin on each side.
    expect(cellWidth(getByTestId('cell-0'))).toBe(62);
  });

  /**
   * The first layout pass on web reports no height, and so does every pass
   * taken while the keyboard is animating in. 0/3 - 4 is -4, and a negative
   * width is a render error rather than a small grid.
   */
  it('floors its cells at zero when handed no room at all', () => {
    const { getByTestId } = render(
      <Grid flashPosition={null} selected={null} onTap={() => {}} size={0} />,
    );
    expect(cellWidth(getByTestId('cell-0'))).toBe(0);
  });

  it('stays square, so the grid never stretches', () => {
    const { getByTestId } = render(
      <Grid flashPosition={null} selected={null} onTap={() => {}} size={197} />,
    );
    const style = StyleSheet.flatten(getByTestId('cell-4').props.style);
    expect(style?.width).toBe(style?.height);
  });
});
