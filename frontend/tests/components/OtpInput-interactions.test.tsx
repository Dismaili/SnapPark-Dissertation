import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { OtpInput } from '../../src/components/ui/OtpInput';

// A controlled wrapper so we can assert end-state of value as the user
// types — testing the parent contract the way it's used in real forms.
function Harness({ length = 4 }: { length?: number }) {
  const [v, setV] = useState('');
  return (
    <>
      <OtpInput value={v} onChange={setV} length={length} autoFocus={false} />
      <output data-testid="value">{v}</output>
    </>
  );
}

describe('OtpInput — interactions', () => {
  it('auto-advances focus on a single-digit entry', async () => {
    render(<Harness />);
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    await userEvent.type(inputs[0], '1');
    expect(screen.getByTestId('value').textContent).toBe('1');
    // focus has moved to the next input
    expect(document.activeElement).toBe(inputs[1]);
  });

  it('strips non-digit characters', async () => {
    render(<Harness />);
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    await userEvent.type(inputs[0], 'a');
    expect(screen.getByTestId('value').textContent).toBe('');
  });

  it('handles a multi-digit paste, distributing across inputs and focusing the last', () => {
    render(<Harness />);
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    fireEvent.change(inputs[0], { target: { value: '1234' } });
    expect(screen.getByTestId('value').textContent).toBe('1234');
    expect(document.activeElement).toBe(inputs[3]);
  });

  it('honours length prop on paste — truncates extras', () => {
    render(<Harness length={4} />);
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    fireEvent.change(inputs[0], { target: { value: '12345678' } });
    expect(screen.getByTestId('value').textContent).toBe('1234');
  });

  it('Backspace on an empty cell jumps back and clears the previous', async () => {
    render(<Harness />);
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    await userEvent.type(inputs[0], '1');
    await userEvent.type(inputs[1], '2');
    // Now focus is on inputs[2] (empty). Backspace should move back + clear inputs[1].
    fireEvent.keyDown(inputs[2], { key: 'Backspace' });
    expect(screen.getByTestId('value').textContent).toBe('1');
    expect(document.activeElement).toBe(inputs[1]);
  });

  it('ArrowLeft / ArrowRight move focus between cells', () => {
    render(<Harness />);
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    inputs[2].focus();
    fireEvent.keyDown(inputs[2], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(inputs[1]);
    fireEvent.keyDown(inputs[1], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(inputs[2]);
  });

  it('autoFocus=true focuses the first input on mount', () => {
    render(<OtpInput value="" onChange={() => {}} autoFocus />);
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(document.activeElement).toBe(inputs[0]);
  });
});
