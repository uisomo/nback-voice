import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SubscriptionModal } from '../SubscriptionModal';

describe('SubscriptionModal', () => {
  it('shows all three tier tabs', () => {
    render(<SubscriptionModal visible onClose={jest.fn()} currentTier="free" />);
    // "Starter" appears twice: once as the tab label, once as the active
    // tier card's title (currentTier="free" selects the Starter tab).
    expect(screen.getAllByText('Starter').length).toBeGreaterThan(0);
    expect(screen.getByText('Funds Finance Pro')).toBeTruthy();
    expect(screen.getByText('Funds Finance God')).toBeTruthy();
  });

  it('shows only the selected tier card at a time', () => {
    render(<SubscriptionModal visible onClose={jest.fn()} currentTier="free" />);
    // Starter is selected by default (currentTier="free").
    expect(screen.getByText('$0')).toBeTruthy();
    expect(screen.queryByText('$5')).toBeNull();
    expect(screen.queryByText('$10')).toBeNull();

    fireEvent.press(screen.getByText('Funds Finance Pro'));
    expect(screen.getByText('$5')).toBeTruthy();
    expect(screen.queryByText('$0')).toBeNull();

    fireEvent.press(screen.getByText('Funds Finance God'));
    expect(screen.getByText('$10')).toBeTruthy();
    expect(screen.queryByText('$5')).toBeNull();
  });

  it('shows the coffee/lunch annual copy for Pro and God', () => {
    render(<SubscriptionModal visible onClose={jest.fn()} currentTier="free" />);
    fireEvent.press(screen.getByText('Funds Finance Pro'));
    expect(screen.getByText(/コーヒー一杯分/)).toBeTruthy();

    fireEvent.press(screen.getByText('Funds Finance God'));
    expect(screen.getByText(/昼食一回分/)).toBeTruthy();
  });

  it('switches to monthly pricing within the selected tier', () => {
    render(<SubscriptionModal visible onClose={jest.fn()} currentTier="free" />);
    fireEvent.press(screen.getByText('Funds Finance Pro'));
    expect(screen.getByText('$5')).toBeTruthy();
    fireEvent.press(screen.getByText('月額'));
    expect(screen.getByText('$10')).toBeTruthy();
  });

  it('persists the chosen tier and calls onTierChanged', async () => {
    const onTierChanged = jest.fn();
    render(
      <SubscriptionModal
        visible
        onClose={jest.fn()}
        currentTier="free"
        onTierChanged={onTierChanged}
      />,
    );
    fireEvent.press(screen.getByText('Funds Finance God'));
    // handleSelectPlan awaits loadSettings/saveSettings (AsyncStorage), so
    // the press needs to be wrapped in an async act to flush the promise
    // before we assert on the callback.
    await act(async () => {
      fireEvent.press(screen.getByText('このプランにする'));
    });
    expect(onTierChanged).toHaveBeenCalledWith('god');
  });

  it('renders nothing when not visible', () => {
    render(<SubscriptionModal visible={false} onClose={jest.fn()} currentTier="free" />);
    expect(screen.queryByText('Starter')).toBeNull();
  });
});
