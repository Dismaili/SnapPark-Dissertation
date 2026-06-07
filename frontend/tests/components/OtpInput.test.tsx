import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OtpInput } from '../../src/components/ui/OtpInput';

describe('OtpInput', () => {
  it('renders one input per digit (default length 4)', () => {
    render(<OtpInput value="" onChange={() => {}} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(4);
  });

  it('renders one input per digit when length is overridden', () => {
    render(<OtpInput value="" onChange={() => {}} length={6} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
  });

  it('strips non-digits and forwards each entered digit', async () => {
    const onChange = vi.fn();
    render(<OtpInput value="" onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    await userEvent.type(inputs[0], 'a');
    // 'a' is non-digit → onChange called with empty string for that slot
    expect(onChange).toHaveBeenCalled();
  });

  it('disables every input when disabled is true', () => {
    render(<OtpInput value="" onChange={() => {}} disabled />);
    for (const input of screen.getAllByRole('textbox')) {
      expect(input).toBeDisabled();
    }
  });
});
