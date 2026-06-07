import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ─── Mock axios so we never hit a real downstream service ────────────────────
// axios is the only outbound dependency the gateway has. We intercept the
// default-callable form (axios({...})) and the .post helper used by the
// /violations/analyze handler.

const mockAxios = vi.fn();
const mockAxiosPost = vi.fn();

vi.mock('axios', () => {
  const fn = (...args) => mockAxios(...args);
  fn.post = (...args) => mockAxiosPost(...args);
  return { default: fn };
});

// Disable rate-limiting noise during tests by setting a huge cap before the
// module is imported (the limiter reads env at import time).
process.env.RATE_LIMIT_MAX_REQUESTS = '100000';

const { app } = await import('../src/index.js');

const VALID_TOKEN = 'Bearer test-token';
const USER_ID     = 'user-1';

// /auth/verify is reached via axios.post() in the authenticate middleware.
// Public auth proxies (login, register, etc.) and /violations/analyze also
// call axios.post(); everything else uses the callable axios({...}) form.
const okVerify = () => mockAxiosPost.mockResolvedValueOnce({
  data: { valid: true, payload: { sub: USER_ID, email: 'u@example.com', role: 'citizen' } },
});

const okVerifyAdmin = () => mockAxiosPost.mockResolvedValueOnce({
  data: { valid: true, payload: { sub: USER_ID, email: 'a@example.com', role: 'admin' } },
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Health ──────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 without auth', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('api-gateway');
  });
});

// ─── Authentication middleware ───────────────────────────────────────────────

describe('authenticate middleware', () => {
  it('401s when Authorization header is missing', async () => {
    const res = await request(app).get('/violations/cases');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Authorization/);
  });

  it('401s when scheme is not Bearer', async () => {
    const res = await request(app).get('/violations/cases').set('Authorization', 'Basic xyz');
    expect(res.status).toBe(401);
  });

  it('401s when auth-service says the token is invalid', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: { valid: false } });
    const res = await request(app)
      .get('/violations/cases')
      .set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(401);
  });

  it('passes through auth-service 401 errors', async () => {
    const err = new Error('unauthorized');
    err.response = { status: 401, data: { valid: false, error: 'Expired token.' } };
    mockAxiosPost.mockRejectedValueOnce(err);
    const res = await request(app)
      .get('/violations/cases')
      .set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Expired/);
  });

  it('503s when the auth-service itself is unreachable', async () => {
    mockAxiosPost.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const res = await request(app)
      .get('/violations/cases')
      .set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(503);
  });
});

// ─── Public auth proxies (proxyJSON) ─────────────────────────────────────────

describe('Public auth proxies', () => {
  it('forwards /auth/register and returns downstream payload', async () => {
    mockAxios.mockResolvedValueOnce({ status: 201, data: { email: 'a@b.c' } });
    const res = await request(app).post('/auth/register').send({ email: 'a@b.c', password: 'pw12345678' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('a@b.c');
  });

  it('forwards /auth/login and surfaces downstream 401', async () => {
    const err = new Error('bad');
    err.response = { status: 401, data: { error: 'Invalid credentials.' } };
    mockAxios.mockRejectedValueOnce(err);
    const res = await request(app).post('/auth/login').send({ email: 'a@b.c', password: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid/);
  });

  it('returns 502 when downstream auth service is unavailable', async () => {
    mockAxios.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app).post('/auth/refresh').send({ refreshToken: 'x' });
    expect(res.status).toBe(502);
  });

  it('proxies /auth/verify-otp as a public route', async () => {
    mockAxios.mockResolvedValueOnce({ status: 200, data: { ok: true } });
    const res = await request(app).post('/auth/verify-otp').send({ email: 'a@b.c', code: '1234' });
    expect(res.status).toBe(200);
  });

  it('proxies /auth/resend-otp as a public route', async () => {
    mockAxios.mockResolvedValueOnce({ status: 200, data: { ok: true } });
    const res = await request(app).post('/auth/resend-otp').send({ email: 'a@b.c' });
    expect(res.status).toBe(200);
  });

  it('proxies /auth/forgot-password as a public route', async () => {
    mockAxios.mockResolvedValueOnce({ status: 200, data: { ok: true } });
    const res = await request(app).post('/auth/forgot-password').send({ email: 'a@b.c' });
    expect(res.status).toBe(200);
  });

  it('proxies /auth/reset-password as a public route', async () => {
    mockAxios.mockResolvedValueOnce({ status: 200, data: { ok: true } });
    const res = await request(app).post('/auth/reset-password').send({
      email: 'a@b.c', code: '1234', newPassword: 'pw12345678',
    });
    expect(res.status).toBe(200);
  });
});

// ─── Authenticated routes / requireOwnUserId / enforceQueryUserId ────────────

describe('Authenticated routes', () => {
  it('GET /violations/cases injects authenticated userId for non-admins', async () => {
    okVerify();
    mockAxios.mockResolvedValueOnce({ status: 200, data: { cases: [], count: 0 } });

    const res = await request(app)
      .get('/violations/cases')
      .query({ userId: 'someone-else' })
      .set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(200);
    // Only one downstream axios({...}) call — auth verify uses axios.post().
    const downstreamCall = mockAxios.mock.calls[0][0];
    expect(downstreamCall.params.userId).toBe(USER_ID);
  });

  it('GET /violations/cases preserves admin userId filter', async () => {
    okVerifyAdmin();
    mockAxios.mockResolvedValueOnce({ status: 200, data: { cases: [] } });
    const res = await request(app)
      .get('/violations/cases')
      .query({ userId: 'admin-target' })
      .set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(200);
    expect(mockAxios.mock.calls[0][0].params.userId).toBe('admin-target');
  });

  it('GET /violations/stats/:userId blocks cross-user access', async () => {
    okVerify();
    const res = await request(app)
      .get('/violations/stats/another-user')
      .set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(403);
  });

  it('GET /violations/stats/:userId allows self', async () => {
    okVerify();
    mockAxios.mockResolvedValueOnce({ status: 200, data: { total_cases: 1 } });
    const res = await request(app)
      .get(`/violations/stats/${USER_ID}`)
      .set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.total_cases).toBe(1);
  });

  it('GET /violations/stats/:userId allows admins to see any user', async () => {
    okVerifyAdmin();
    mockAxios.mockResolvedValueOnce({ status: 200, data: { total_cases: 9 } });
    const res = await request(app)
      .get('/violations/stats/any-other-user')
      .set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(200);
  });

  it('proxyAuthenticated forwards X-User-Id and X-User-Role headers', async () => {
    okVerify();
    mockAxios.mockResolvedValueOnce({ status: 200, data: { id: 'case-1' } });
    await request(app).get('/violations/case-1').set('Authorization', VALID_TOKEN);
    const { headers } = mockAxios.mock.calls[0][0];
    expect(headers['X-User-Id']).toBe(USER_ID);
    expect(headers['X-User-Role']).toBe('citizen');
  });

  it('proxyAuthenticated streams image bytes via arraybuffer response type', async () => {
    okVerify();
    const pixel = Buffer.from('hi-image');
    mockAxios.mockResolvedValueOnce({
      status: 200,
      data: pixel,
      headers: { 'content-type': 'image/png' },
    });

    const res = await request(app)
      .get('/violations/case-1/images/0')
      .set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
  });

  it('proxyAuthenticated returns 502 on downstream failure', async () => {
    okVerify();
    mockAxios.mockRejectedValueOnce(new Error('downstream down'));
    const res = await request(app)
      .get('/violations/case-1')
      .set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(502);
  });

  it('proxyAuthenticated bubbles downstream error status and body', async () => {
    okVerify();
    const err = new Error('bad');
    err.response = { status: 404, data: { error: 'Case not found.' } };
    mockAxios.mockRejectedValueOnce(err);
    const res = await request(app)
      .get('/violations/case-1')
      .set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it.each([
    ['get',    '/violations/case-1/similar', 200],
    ['get',    '/violations/case-1/status',  200],
    ['get',    '/violations/case-1/audit',   200],
    ['patch',  '/violations/case-1/report',  200],
    ['patch',  '/violations/case-1/resolve', 200],
    ['delete', '/violations/case-1',         200],
  ])('routes %s %s through authenticate + proxyAuthenticated', async (method, path, expected) => {
    okVerify();
    mockAxios.mockResolvedValueOnce({ status: expected, data: { ok: true } });
    const res = await request(app)[method](path).set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(expected);
  });
});

// ─── Notification proxies ────────────────────────────────────────────────────

describe('Notification proxies', () => {
  it('GET /notifications enforces userId for non-admin', async () => {
    okVerify();
    mockAxios.mockResolvedValueOnce({ status: 200, data: { notifications: [] } });
    await request(app)
      .get('/notifications')
      .query({ userId: 'someone' })
      .set('Authorization', VALID_TOKEN);
    expect(mockAxios.mock.calls[0][0].params.userId).toBe(USER_ID);
  });

  it('PATCH /notifications/read-all/:userId blocks cross-user', async () => {
    okVerify();
    const res = await request(app)
      .patch('/notifications/read-all/other-user')
      .set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(403);
  });

  it('PATCH /notifications/read-all/:userId proxies for self', async () => {
    okVerify();
    mockAxios.mockResolvedValueOnce({ status: 200, data: { markedRead: 2 } });
    const res = await request(app)
      .patch(`/notifications/read-all/${USER_ID}`)
      .set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(200);
  });

  it.each([
    ['get',  `/notifications/unread-count/${USER_ID}`],
    ['get',  `/notifications/preferences/${USER_ID}`],
    ['put',  `/notifications/preferences/${USER_ID}`],
    ['get',  '/notifications/delivery-log/case-1'],
    ['get',  '/notifications/case/case-1'],
    ['get',  '/notifications/notif-1'],
    ['patch','/notifications/notif-1/read'],
  ])('routes %s %s through the gateway', async (method, path) => {
    okVerify();
    mockAxios.mockResolvedValueOnce({ status: 200, data: { ok: true } });
    const res = await request(app)[method](path).set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(200);
  });
});

// ─── /violations/analyze (multipart) ─────────────────────────────────────────

describe('POST /violations/analyze', () => {
  it('400s when no file is attached', async () => {
    okVerify();
    const res = await request(app)
      .post('/violations/analyze')
      .set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/image/i);
  });

  it('400s when an unsupported MIME type is uploaded', async () => {
    okVerify();
    const res = await request(app)
      .post('/violations/analyze')
      .set('Authorization', VALID_TOKEN)
      .attach('image', Buffer.from('hi'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid image type/);
  });

  it('forwards a valid image to the violation service', async () => {
    okVerify();
    mockAxiosPost.mockResolvedValueOnce({ status: 201, data: { caseId: 'case-1' } });
    const res = await request(app)
      .post('/violations/analyze')
      .set('Authorization', VALID_TOKEN)
      .attach('image', Buffer.from('img'), { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(201);
    expect(res.body.caseId).toBe('case-1');
  });

  it('502s when downstream violation service fails', async () => {
    okVerify();
    mockAxiosPost.mockRejectedValueOnce(new Error('down'));
    const res = await request(app)
      .post('/violations/analyze')
      .set('Authorization', VALID_TOKEN)
      .attach('image', Buffer.from('img'), { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(502);
  });

  it('bubbles downstream status when violation service returns 422', async () => {
    okVerify();
    const err = new Error('quality');
    err.response = { status: 422, data: { error: 'quality', reason: 'blurry' } };
    mockAxiosPost.mockRejectedValueOnce(err);
    const res = await request(app)
      .post('/violations/analyze')
      .set('Authorization', VALID_TOKEN)
      .attach('image', Buffer.from('img'), { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('blurry');
  });
});

// ─── 404 fallback ────────────────────────────────────────────────────────────

describe('404 fallback', () => {
  it('returns JSON 404 for unmatched routes', async () => {
    const res = await request(app).get('/no-such-route');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
