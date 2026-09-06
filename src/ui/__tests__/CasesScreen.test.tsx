import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { listCases } from '../../cases/cases';
import { CasesScreen } from '../CasesScreen';

describe('CasesScreen', () => {
  it('renders every case with its title', async () => {
    render(<CasesScreen onSelect={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId(`case-${listCases()[0].id}`)).toBeTruthy();
    });
    for (const c of listCases()) {
      expect(screen.getByText(c.title)).toBeTruthy();
    }
  });

  it('shows the turn count for a case', async () => {
    render(<CasesScreen onSelect={jest.fn()} />);
    const first = listCases()[0];
    await waitFor(() => {
      expect(screen.getByTestId(`case-count-${first.id}`)).toHaveTextContent(
        String(first.conversation.length),
      );
    });
  });

  it('calls onSelect with the case id on press', async () => {
    const onSelect = jest.fn();
    render(<CasesScreen onSelect={onSelect} />);
    const first = listCases()[0];
    await waitFor(() => expect(screen.getByTestId(`case-${first.id}`)).toBeTruthy());
    fireEvent.press(screen.getByTestId(`case-${first.id}`));
    expect(onSelect).toHaveBeenCalledWith(first.id);
  });
});
