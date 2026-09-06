import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { listSequences } from '../../actions/actions';
import { SequencesScreen } from '../SequencesScreen';

describe('SequencesScreen', () => {
  it('renders every sequence with its goal', async () => {
    render(<SequencesScreen onSelect={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId(`seq-${listSequences()[0].id}`)).toBeTruthy();
    });
    for (const s of listSequences()) {
      expect(screen.getByText(s.goal)).toBeTruthy();
    }
  });

  it('shows the card count for a sequence', async () => {
    render(<SequencesScreen onSelect={jest.fn()} />);
    const first = listSequences()[0];
    await waitFor(() => {
      expect(screen.getByTestId(`seq-count-${first.id}`)).toHaveTextContent(
        String(first.cards.length),
      );
    });
  });

  it('calls onSelect with the sequence id on press', async () => {
    const onSelect = jest.fn();
    render(<SequencesScreen onSelect={onSelect} />);
    const first = listSequences()[0];
    await waitFor(() => expect(screen.getByTestId(`seq-${first.id}`)).toBeTruthy());
    fireEvent.press(screen.getByTestId(`seq-${first.id}`));
    expect(onSelect).toHaveBeenCalledWith(first.id);
  });
});
