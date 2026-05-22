import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Same mock surface as gateway.test.js — covers the remaining decision
// branches: proxyAuthenticated default role fallback, multer LIMIT_FILE_SIZE,
// downstream-no-response paths, multer LIMIT_UNEXPECTED_FILE is unreachable
// because /violations/analyze uses .single('image'), but we still exercise
// the unhandled-error path.

const mockAxios = vi.fn();
const mockAxiosPost = vi.fn();
vi.mock('axios', () => {
  const fn = (...args) => mockAxios(...args);
  fn.post = (...args) => mockAxiosPost(...args);
  return { default: fn };
});

process.env.RATE_LIMIT_MAX_REQUESTS = '100000';
process.env.MAX_IMAGE_SIZE = '32'; // tiny size so we can trigger LIMIT_FILE_SIZE

const { app } = await import('../src/index.js');

const VALID_TOKEN = 'Bearer t';
const USER_ID = 'u';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('proxyAuthenticated — default role fallback', () => {
  it('falls back to "citizen" role when auth-service omits role', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: { valid: true, payload: { sub: USER_ID, email: 'u@x.c' } } });
    mockAxios.mockResolvedValueOnce({ status: 200, data: { ok: true } });
    await request(app).get('/violations/case-1').set('Authorization', VALID_TOKEN);
    expect(mockAxios.mock.calls[0][0].headers['X-User-Role']).toBe('citizen');
  });
});

describe('multer error handler', () => {
  it('returns 413 with the size-limit message when the file is too large', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: { valid: true, payload: { sub: USER_ID, email: 'u@x.c', role: 'citizen' } } });
    const big = Buffer.alloc(1024); // way over the 32-byte limit
    const res = await request(app)
      .post('/violations/analyze')
      .set('Authorization', VALID_TOKEN)
      .attach('image', big, { filename: 'big.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/Image too large/);
  });
});

describe('public proxies — downstream sans error body', () => {
  it('falls back to a generic 502 body when downstream gives no response data', async () => {
    const err = new Error('socket hangup');
    mockAxios.mockRejectedValueOnce(err);
    const res = await request(app).post('/auth/register').send({ email: 'a@b.c' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/unavailable/i);
  });
});
