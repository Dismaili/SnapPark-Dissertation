import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthShell } from '../../src/components/ui/AuthShell';

// next/link expects to be rendered inside a Next.js context. For unit tests
// we stub it with a plain anchor so the component renders standalone.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('AuthShell', () => {
  it('renders title, subtitle and children', () => {
    render(
      <AuthShell
        title="Sign in"
        subtitle="Welcome back"
        altLabel="No account?"
        altHref="/register"
        altCta="Create one"
      >
        <p>form goes here</p>
      </AuthShell>,
    );
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByText('form goes here')).toBeInTheDocument();
  });

  it('renders the alt label + cta link to altHref', () => {
    render(
      <AuthShell
        title="Sign in"
        subtitle="Welcome back"
        altLabel="No account?"
        altHref="/register"
        altCta="Create one"
      >
        <p>x</p>
      </AuthShell>,
    );
    const link = screen.getByRole('link', { name: 'Create one' });
    expect(link).toHaveAttribute('href', '/register');
  });
});
