import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiFetch, apiUploadImage, apiFetchBlobUrl, ApiError, API_URL } from '../../src/lib/api';
import { tokenStore } from '../../src/lib/auth';

const ok = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  blob: async () => new Blob([JSON.stringify(body)]),
});

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn();
  // jsdom does not provide URL.createObjectURL by default
  (globalThis.URL as any).createObjectURL = vi.fn(() => 'blob:fake');
});

// ─── apiFetch ────────────────────────────────────────────────────────────────

describe('apiFetch', () => {
  it('sends Content-Type JSON + Bearer token when auth=true', async () => {
    tokenStore.set('the-token', 'r', { id: 'u', email: 'a' });
    (globalThis.fetch as any).mockResolvedValueOnce(ok(200, { ok: true }));

    const result = await apiFetch<{ ok: boolean }>('/x', { method: 'POST', body: { a: 1 } });
    expect(result).toEqual({ ok: true });

    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe(`${API_URL}/x`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('Bearer the-token');
  });

  it('omits Authorization when auth=false', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(ok(200, {}));
    await apiFetch('/x', { auth: false });
    const [, init] = (globalThis.fetch as any).mock.calls[0];
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  });

  it('throws ApiError with the parsed body on non-2xx', async () => {
    (globalThis.fetch as any)
      .mockResolvedValueOnce(ok(409, { error: 'taken' }))
      .mockResolvedValueOnce(ok(409, { error: 'taken' }));
    await expect(apiFetch('/x')).rejects.toThrow('taken');
    try {
      await apiFetch('/x');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(409);
    }
  });

  it('returns null when the response body is empty', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true, status: 204, text: async () => '',
    });
    const r = await apiFetch('/x');
    expect(r).toBeNull();
  });

  it('returns the raw text when the body is not JSON', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true, status: 200, text: async () => 'plain-text',
    });
    const r = await apiFetch<string>('/x');
    expect(r).toBe('plain-text');
  });
});

// ─── apiUploadImage ──────────────────────────────────────────────────────────

describe('apiUploadImage', () => {
  it('builds multipart body with image and optional extras', async () => {
    tokenStore.set('tok', 'r', { id: 'u', email: 'a' });
    (globalThis.fetch as any).mockResolvedValueOnce(ok(201, { caseId: 'c' }));

    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const r = await apiUploadImage<{ caseId: string }>('/violations/analyze', file, {
      licensePlate: 'ABC123', latitude: 1.1, longitude: 2.2, locationLabel: 'X',
    });
    expect(r.caseId).toBe('c');

    const [, init] = (globalThis.fetch as any).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get('licensePlate')).toBe('ABC123');
    expect(init.body.get('latitude')).toBe('1.1');
    expect(init.body.get('longitude')).toBe('2.2');
    expect(init.body.get('locationLabel')).toBe('X');
    expect(init.headers.get('Authorization')).toBe('Bearer tok');
  });

  it('throws ApiError on upload failure', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(ok(422, { error: 'quality' }));
    const file = new File(['x'], 'x.jpg', { type: 'image/jpeg' });
    await expect(apiUploadImage('/upload', file)).rejects.toThrow('quality');
  });
});

// ─── apiFetchBlobUrl ─────────────────────────────────────────────────────────

describe('apiFetchBlobUrl', () => {
  it('returns an object URL on success', async () => {
    tokenStore.set('tok', 'r', { id: 'u', email: 'a' });
    (globalThis.fetch as any).mockResolvedValueOnce(ok(200, { not: 'used' }));
    const url = await apiFetchBlobUrl('/violations/c/images/0');
    expect(url).toBe('blob:fake');
  });

  it('throws ApiError on non-2xx', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: false, status: 404, text: async () => 'not found',
    });
    await expect(apiFetchBlobUrl('/x')).rejects.toThrow();
  });
});
