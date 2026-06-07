import { describe, it, expect, beforeEach } from 'vitest';
import { tokenStore } from '../../src/lib/auth';

beforeEach(() => {
  localStorage.clear();
});

describe('tokenStore', () => {
  it('returns null when nothing is stored', () => {
    expect(tokenStore.getToken()).toBeNull();
    expect(tokenStore.getRefreshToken()).toBeNull();
    expect(tokenStore.getUser()).toBeNull();
  });

  it('persists token / refresh / user via set()', () => {
    const user = { id: 'u1', email: 'a@b.c', role: 'citizen' as const, emailVerified: true };
    tokenStore.set('access-tok', 'refresh-tok', user);

    expect(tokenStore.getToken()).toBe('access-tok');
    expect(tokenStore.getRefreshToken()).toBe('refresh-tok');
    expect(tokenStore.getUser()).toEqual(user);
  });

  it('clear() removes every key', () => {
    tokenStore.set('a', 'b', { id: 'u', email: 'e' });
    tokenStore.clear();
    expect(tokenStore.getToken()).toBeNull();
    expect(tokenStore.getRefreshToken()).toBeNull();
    expect(tokenStore.getUser()).toBeNull();
  });

  it('returns null when the persisted user is corrupt JSON', () => {
    localStorage.setItem('snappark.user', '{not-json');
    expect(tokenStore.getUser()).toBeNull();
  });
});
