import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from '../../src/components/ui/PageHeader';

describe('PageHeader', () => {
  it('renders title and description', () => {
    render(<PageHeader title="My title" description="my desc" />);
    expect(screen.getByRole('heading', { name: 'My title' })).toBeInTheDocument();
    expect(screen.getByText('my desc')).toBeInTheDocument();
  });

  it('omits the description paragraph when not provided', () => {
    const { container } = render(<PageHeader title="Just title" />);
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });

  it('renders an action node when provided', () => {
    render(<PageHeader title="x" action={<button>Save</button>} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
