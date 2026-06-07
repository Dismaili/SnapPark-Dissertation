import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../../src/components/ui/StatusBadge';

describe('StatusBadge', () => {
  it('renders the friendly label for a known status', () => {
    render(<StatusBadge status="completed" />);
    expect(screen.getByText('Analysed')).toBeInTheDocument();
  });

  it('renders "Reported" for reported_to_authority', () => {
    render(<StatusBadge status="reported_to_authority" />);
    expect(screen.getByText('Reported')).toBeInTheDocument();
  });

  it('falls back to the raw status when unknown', () => {
    render(<StatusBadge status="something-else" />);
    expect(screen.getByText('something-else')).toBeInTheDocument();
  });
});
