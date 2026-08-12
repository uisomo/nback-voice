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
