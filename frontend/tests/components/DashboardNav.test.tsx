import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ─── Next.js stubs ───────────────────────────────────────────────────────────
const mockReplace = vi.fn();
const mockPathname = vi.fn(() => '/dashboard');

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  usePathname: () => mockPathname(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// ─── lib stubs ───────────────────────────────────────────────────────────────
const mockApiFetch = vi.fn().mockResolvedValue({ unreadCount: 0 });
vi.mock('@/lib/api', () => ({
  apiFetch: (...a: any[]) => mockApiFetch(...a),
}));

const mockClear = vi.fn();
const mockGetRefresh = vi.fn(() => 'refresh-tok');
vi.mock('@/lib/auth', () => ({
  tokenStore: {
    getRefreshToken: () => mockGetRefresh(),
    clear: () => mockClear(),
    getUser: () => null,
    getToken: () => null,
    set: vi.fn(),
  },
}));

// Stub the lucide icons so we don't depend on the real package's per-icon
// resolution mechanics in jsdom.
vi.mock('lucide-react', () => {
  const Stub = () => <span data-testid="icon" />;
  return { Camera: Stub, ListChecks: Stub, Bell: Stub, Settings: Stub, LogOut: Stub, ShieldCheck: Stub };
});

const { DashboardNav } = await import('../../src/components/layout/DashboardNav');

const renderNav = (user: any) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DashboardNav user={user} />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DashboardNav', () => {
  it('renders the citizen navigation links by default', () => {
    renderNav({ id: 'u1', email: 'u@x.c', role: 'citizen' });
    expect(screen.getByText('My cases')).toBeInTheDocument();
    expect(screen.getByText('New report')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.queryByText('All cases (admin)')).not.toBeInTheDocument();
  });

  it('adds the admin link when role is admin', () => {
    renderNav({ id: 'admin', email: 'a@x.c', role: 'admin' });
    expect(screen.getByText('All cases (admin)')).toBeInTheDocument();
  });

  it('shows the greeting when firstName is provided', () => {
    renderNav({ id: 'u1', email: 'u@x.c', role: 'citizen', firstName: 'Dris' });
    expect(screen.getByText('Hi, Dris')).toBeInTheDocument();
  });

  it('clicking sign-out calls tokenStore.clear and replaces to /login', async () => {
    renderNav({ id: 'u1', email: 'u@x.c', role: 'citizen' });
    fireEvent.click(screen.getByText('Sign out'));
    await waitFor(() => {
      expect(mockClear).toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith('/login');
    });
  });
});
