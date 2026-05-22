import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockReplace = vi.fn();
let mockPathnameValue = '/dashboard';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  usePathname: () => mockPathnameValue,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}));

let mockApiResponse: any = { unreadCount: 0 };
vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve(mockApiResponse)),
}));

let mockUserValue: any = null;
let mockTokenValue: string | null = null;
const mockClear = vi.fn();
vi.mock('@/lib/auth', () => ({
  tokenStore: {
    getUser: () => mockUserValue,
    getToken: () => mockTokenValue,
    getRefreshToken: () => 'r',
    clear: () => mockClear(),
    set: vi.fn(),
  },
}));

vi.mock('lucide-react', () => {
  const Stub = () => <span />;
  return { Camera: Stub, ListChecks: Stub, Bell: Stub, Settings: Stub, LogOut: Stub, ShieldCheck: Stub };
});

const { DashboardNav, useAuthGuard } = await import('../../src/components/layout/DashboardNav');

const wrap = (children: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApiResponse = { unreadCount: 0 };
  mockPathnameValue = '/dashboard';
  mockUserValue = null;
  mockTokenValue = null;
});

describe('DashboardNav — additional branches', () => {
  it('shows the unread badge when count > 0', async () => {
    mockApiResponse = { unreadCount: 3 };
    render(wrap(<DashboardNav user={{ id: 'u', email: 'u@x.c', role: 'citizen' }} />));
    // Wait for the React Query result to populate.
    await new Promise((r) => setTimeout(r, 0));
    // Force a re-render via state — easier just to look at the document.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('3')).toBeTruthy();
  });

  it('falls back to "Signed in" greeting when firstName missing', () => {
    render(wrap(<DashboardNav user={{ id: 'u', email: 'u@x.c', role: 'citizen' }} />));
    expect(screen.getByText('Signed in')).toBeInTheDocument();
  });

  it('marks /upload as active when pathname starts with it', () => {
    mockPathnameValue = '/upload/wizard';
    render(wrap(<DashboardNav user={{ id: 'u', email: 'u@x.c', role: 'citizen' }} />));
    const link = screen.getByText('New report').closest('a')!;
    expect(link.className).toMatch(/emerald/);
  });
});

describe('useAuthGuard', () => {
  it('redirects to "/" and clears tokens when no user/token is stored', () => {
    mockUserValue = null;
    mockTokenValue = null;
    renderHook(() => useAuthGuard());
    expect(mockClear).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('returns the stored user when both user and token exist', () => {
    mockUserValue = { id: 'u1', email: 'u@x.c' };
    mockTokenValue = 'tok';
    const { result } = renderHook(() => useAuthGuard());
    // The hook sets state asynchronously via useEffect — wait a tick.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(result.current?.id).toBe('u1');
        expect(mockReplace).not.toHaveBeenCalled();
        resolve();
      }, 0);
    });
  });
});
