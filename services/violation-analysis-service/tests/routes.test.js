import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ─── Mock every external dependency before importing the app ────────────────
// The route file pulls in db / rabbitmq / gemini / saga modules at import
// time. We replace each with a vi.fn-driven double so the routes can be
// exercised without Postgres, RabbitMQ or the Gemini API.

const mockQuery               = vi.fn();
const mockInitDB              = vi.fn().mockResolvedValue();
const mockInsertCaseImages    = vi.fn().mockResolvedValue();
const mockGetCaseImages       = vi.fn();
const mockGetCaseImageBytes   = vi.fn();
const mockAuditLog            = vi.fn().mockResolvedValue();
const mockGetAuditLog         = vi.fn();
const mockGetAuditLogByUser   = vi.fn();
const mockFindSimilarCases    = vi.fn();

vi.mock('../src/db.js', () => ({
  query:               (...a) => mockQuery(...a),
  initDB:              (...a) => mockInitDB(...a),
  insertCaseImages:    (...a) => mockInsertCaseImages(...a),
  getCaseImages:       (...a) => mockGetCaseImages(...a),
  getCaseImageBytes:   (...a) => mockGetCaseImageBytes(...a),
  auditLog:            (...a) => mockAuditLog(...a),
  getAuditLog:         (...a) => mockGetAuditLog(...a),
  getAuditLogByUser:   (...a) => mockGetAuditLogByUser(...a),
  findSimilarCases:    (...a) => mockFindSimilarCases(...a),
  default: {},
}));

vi.mock('../src/rabbitmq.js', () => ({
  connectRabbitMQ:      vi.fn().mockResolvedValue(),
  publishCaseCreated:   vi.fn(),
  publishCaseReported:  vi.fn(),
  publishCaseResolved:  vi.fn(),
}));

const mockAnalyseImage = vi.fn();
const mockAnalyseMultipleImages = vi.fn();
vi.mock('../src/gemini.js', () => ({
  analyseImage:          (...a) => mockAnalyseImage(...a),
  analyseMultipleImages: (...a) => mockAnalyseMultipleImages(...a),
}));

const mockValidateImageQuality = vi.fn();
vi.mock('../src/imageValidator.js', () => ({
  validateImageQuality: (...a) => mockValidateImageQuality(...a),
}));

vi.mock('../src/cleanup.js', () => ({
  startCleanupJob: vi.fn(),
}));

const mockRunCaseCreationSaga = vi.fn();
vi.mock('../src/saga/caseCreationSaga.js', () => ({
  runCaseCreationSaga: (...a) => mockRunCaseCreationSaga(...a),
}));

const mockGetSaga = vi.fn();
vi.mock('../src/saga/coordinator.js', () => ({
  getSaga: (...a) => mockGetSaga(...a),
}));

vi.mock('../src/saga/listeners.js', () => ({
  startSagaListener: vi.fn().mockResolvedValue(),
}));

// Importing app must happen AFTER all vi.mock() calls above.
const { app } = await import('../src/index.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const png1x1 = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A4944415478DA63000100000005000100' +
  '0D0A2DB40000000049454E44AE426082',
  'hex'
);

const CASE_ID  = '00000000-0000-0000-0000-000000000001';
const OWNER_ID = 'owner-1';
const OTHER_ID = 'someone-else';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── /health ─────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with service identity and timestamp', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('violation-analysis-service');
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });
});

// ─── /violations/analyze ─────────────────────────────────────────────────────

describe('POST /violations/analyze', () => {
  it('returns 400 when userId is missing', async () => {
    const res = await request(app)
      .post('/violations/analyze')
      .send({ image: png1x1.toString('base64'), mimeType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/userId/i);
  });

  it('returns 400 when neither image fields nor file are provided', async () => {
    // No image fields means extractMeta never runs and userId stays undefined,
    // so we fall through to the userId-required check. Either way: 400.
    const res = await request(app)
      .post('/violations/analyze')
      .send({ userId: OWNER_ID });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid mimeType in JSON body', async () => {
    const res = await request(app)
      .post('/violations/analyze')
      .send({ userId: OWNER_ID, image: png1x1.toString('base64'), mimeType: 'image/gif' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mimeType/i);
  });

  it('returns 422 when image quality validation fails', async () => {
    mockValidateImageQuality.mockResolvedValue({ valid: false, reason: 'too blurry' });
    const res = await request(app)
      .post('/violations/analyze')
      .send({ userId: OWNER_ID, image: png1x1.toString('base64'), mimeType: 'image/png' });
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('too blurry');
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'ImageQualityRejected' }));
  });

  it('returns 502 when the saga fails', async () => {
    mockValidateImageQuality.mockResolvedValue({ valid: true, stats: {} });
    const sagaErr = new Error('boom');
    sagaErr.sagaId = 'saga-123';
    sagaErr.failedStep = 'gemini';
    sagaErr.compensated = ['insertCase'];
    mockRunCaseCreationSaga.mockRejectedValue(sagaErr);

    const res = await request(app)
      .post('/violations/analyze')
      .send({ userId: OWNER_ID, image: png1x1.toString('base64'), mimeType: 'image/png' });
    expect(res.status).toBe(502);
    expect(res.body.sagaId).toBe('saga-123');
    expect(res.body.failedStep).toBe('gemini');
  });

  it('returns 201 with the case on a successful saga', async () => {
    mockValidateImageQuality.mockResolvedValue({ valid: true, stats: {} });
    mockRunCaseCreationSaga.mockResolvedValue({
      sagaId: 'saga-ok',
      savedCase: {
        id: CASE_ID, user_id: OWNER_ID, status: 'completed', image_count: 1,
        created_at: '2026-01-01T00:00:00Z',
      },
      analysis: { violationConfirmed: true, confidence: 0.9 },
    });

    const res = await request(app)
      .post('/violations/analyze')
      .send({ userId: OWNER_ID, image: png1x1.toString('base64'), mimeType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.caseId).toBe(CASE_ID);
    expect(res.body.sagaId).toBe('saga-ok');
    expect(res.body.analysis.violationConfirmed).toBe(true);
  });

  it('accepts multipart upload (single file) and runs the saga', async () => {
    mockValidateImageQuality.mockResolvedValue({ valid: true, stats: {} });
    mockRunCaseCreationSaga.mockResolvedValue({
      sagaId: 'saga-multi',
      savedCase: {
        id: CASE_ID, user_id: OWNER_ID, status: 'completed', image_count: 1,
        created_at: '2026-01-01T00:00:00Z',
      },
      analysis: { violationConfirmed: false },
    });

    const res = await request(app)
      .post('/violations/analyze')
      .field('userId', OWNER_ID)
      .field('email', 'owner@example.com')
      .field('licensePlate', 'ab123cd')
      .field('latitude', '42.6629')
      .field('longitude', '21.1655')
      .field('locationLabel', 'Pristina')
      .attach('images', png1x1, { filename: 'photo.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    const call = mockRunCaseCreationSaga.mock.calls[0][0];
    expect(call.context.userId).toBe(OWNER_ID);
    expect(call.context.licensePlate).toBe('AB123CD');
    expect(call.context.latitude).toBeCloseTo(42.6629);
  });
});

// ─── /violations/cases ───────────────────────────────────────────────────────

describe('GET /violations/cases', () => {
  it('returns paginated cases with default limits', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '2' }] })
      .mockResolvedValueOnce({ rows: [{ id: CASE_ID }], rowCount: 1 });
    const res = await request(app).get('/violations/cases');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.limit).toBe(50);
    expect(res.body.offset).toBe(0);
    expect(res.body.cases).toHaveLength(1);
  });

  it('applies userId / status / from / to filters into the SQL', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get('/violations/cases')
      .query({ userId: OWNER_ID, status: 'completed', from: '2026-01-01', to: '2026-12-31', limit: '10', offset: '5' });
    expect(res.status).toBe(200);
    const countSql = mockQuery.mock.calls[0][0];
    expect(countSql).toMatch(/user_id = \$1/);
    expect(countSql).toMatch(/status = \$2/);
    expect(countSql).toMatch(/created_at >= \$3/);
    expect(countSql).toMatch(/created_at <= \$4/);
    expect(res.body.limit).toBe(10);
    expect(res.body.offset).toBe(5);
  });

  it('clamps the limit to 200', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/violations/cases').query({ limit: '9999' });
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(200);
  });

  it('returns 500 if the DB query throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/violations/cases');
    expect(res.status).toBe(500);
  });
});

// ─── /violations/stats/:userId ───────────────────────────────────────────────

describe('GET /violations/stats/:userId', () => {
  it('returns the aggregate statistics row', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        total_cases: '4', violations_confirmed: '3', violations_not_confirmed: '1',
        status_completed: '2', status_reported: '1', status_resolved: '1', status_cancelled: '0',
        avg_confidence: '0.8500',
      }],
    });
    const res = await request(app).get(`/violations/stats/${OWNER_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(OWNER_ID);
    expect(res.body.total_cases).toBe('4');
  });

  it('returns 500 on DB failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db'));
    const res = await request(app).get(`/violations/stats/${OWNER_ID}`);
    expect(res.status).toBe(500);
  });
});

// ─── /violations/:id ─────────────────────────────────────────────────────────

describe('GET /violations/:id', () => {
  it('returns 404 when no case row matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/violations/${CASE_ID}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 when a non-owner non-admin requests it', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CASE_ID, user_id: OWNER_ID }] });
    const res = await request(app)
      .get(`/violations/${CASE_ID}`)
      .set('x-user-id', OTHER_ID)
      .set('x-user-role', 'citizen');
    expect(res.status).toBe(403);
  });

  it('returns 200 for the owner with images attached', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CASE_ID, user_id: OWNER_ID, status: 'completed' }] });
    mockGetCaseImages.mockResolvedValue([{ image_index: 0, image_mime_type: 'image/png' }]);
    const res = await request(app)
      .get(`/violations/${CASE_ID}`)
      .set('x-user-id', OWNER_ID);
    expect(res.status).toBe(200);
    expect(res.body.images).toHaveLength(1);
  });

  it('allows an admin to view any case', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CASE_ID, user_id: OWNER_ID }] });
    mockGetCaseImages.mockResolvedValue([]);
    const res = await request(app)
      .get(`/violations/${CASE_ID}`)
      .set('x-user-id', OTHER_ID)
      .set('x-user-role', 'admin');
    expect(res.status).toBe(200);
  });
});

// ─── /violations/:id/status ──────────────────────────────────────────────────

describe('GET /violations/:id/status', () => {
  it('404s for an unknown id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/violations/${CASE_ID}/status`);
    expect(res.status).toBe(404);
  });

  it('returns status-only fields for the owner', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CASE_ID, user_id: OWNER_ID, status: 'completed' }] });
    const res = await request(app)
      .get(`/violations/${CASE_ID}/status`)
      .set('x-user-id', OWNER_ID);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });

  it('returns 403 for a non-owner non-admin', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CASE_ID, user_id: OWNER_ID, status: 'completed' }] });
    const res = await request(app)
      .get(`/violations/${CASE_ID}/status`)
      .set('x-user-id', OTHER_ID);
    expect(res.status).toBe(403);
  });
});

// ─── /violations/:id/images/:index ───────────────────────────────────────────

describe('GET /violations/:id/images/:index', () => {
  it('rejects non-integer index with 400', async () => {
    const res = await request(app).get(`/violations/${CASE_ID}/images/abc`);
    expect(res.status).toBe(400);
  });

  it('returns 404 when the case does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/violations/${CASE_ID}/images/0`);
    expect(res.status).toBe(404);
  });

  it('returns 403 when caller is not owner', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] });
    const res = await request(app)
      .get(`/violations/${CASE_ID}/images/0`)
      .set('x-user-id', OTHER_ID);
    expect(res.status).toBe(403);
  });

  it('404s when the image row is missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] });
    mockGetCaseImageBytes.mockResolvedValue(null);
    const res = await request(app).get(`/violations/${CASE_ID}/images/0`);
    expect(res.status).toBe(404);
  });

  it('streams the image bytes with the right content-type', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] });
    mockGetCaseImageBytes.mockResolvedValue({ image_mime_type: 'image/png', image_data: png1x1 });
    const res = await request(app).get(`/violations/${CASE_ID}/images/0`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
  });
});

// ─── /violations/:id/report ──────────────────────────────────────────────────

describe('PATCH /violations/:id/report', () => {
  it('404s for unknown case', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch(`/violations/${CASE_ID}/report`);
    expect(res.status).toBe(404);
  });

  it('returns 403 if the caller does not own the case', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID, violation_confirmed: true, status: 'completed' }] });
    const res = await request(app)
      .patch(`/violations/${CASE_ID}/report`)
      .set('x-user-id', OTHER_ID);
    expect(res.status).toBe(403);
  });

  it('returns 409 when the violation is not confirmed', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID, violation_confirmed: false, status: 'completed' }] });
    const res = await request(app)
      .patch(`/violations/${CASE_ID}/report`)
      .set('x-user-id', OWNER_ID);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/confirmed/i);
  });

  it('returns 409 when already reported', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID, violation_confirmed: true, status: 'reported_to_authority' }] });
    const res = await request(app)
      .patch(`/violations/${CASE_ID}/report`)
      .set('x-user-id', OWNER_ID);
    expect(res.status).toBe(409);
  });

  it('returns 409 when resolved', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID, violation_confirmed: true, status: 'resolved' }] });
    const res = await request(app)
      .patch(`/violations/${CASE_ID}/report`)
      .set('x-user-id', OWNER_ID);
    expect(res.status).toBe(409);
  });

  it('returns 409 when status is not "completed"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID, violation_confirmed: true, status: 'pending' }] });
    const res = await request(app)
      .patch(`/violations/${CASE_ID}/report`)
      .set('x-user-id', OWNER_ID);
    expect(res.status).toBe(409);
  });

  it('reports successfully and writes audit + publish', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: CASE_ID, user_id: OWNER_ID, violation_confirmed: true, status: 'completed' }] })
      .mockResolvedValueOnce({ rows: [{
        id: CASE_ID, user_id: OWNER_ID, status: 'reported_to_authority',
        violation_confirmed: true, violation_type: 'double parking', confidence: 0.9,
        explanation: 'x', license_plate: 'AB123CD', reported_at: '2026-01-01T00:00:00Z',
      }] });

    const res = await request(app)
      .patch(`/violations/${CASE_ID}/report`)
      .set('x-user-id', OWNER_ID);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('reported_to_authority');
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'CaseReported' }));
  });
});

// ─── /violations/:id/resolve ─────────────────────────────────────────────────

describe('PATCH /violations/:id/resolve', () => {
  it('404s for unknown case', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch(`/violations/${CASE_ID}/resolve`);
    expect(res.status).toBe(404);
  });

  it('returns 409 if not in reported state', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CASE_ID, user_id: OWNER_ID, status: 'completed' }] });
    const res = await request(app).patch(`/violations/${CASE_ID}/resolve`);
    expect(res.status).toBe(409);
  });

  it('marks resolved and audits', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: CASE_ID, user_id: OWNER_ID, status: 'reported_to_authority' }] })
      .mockResolvedValueOnce({ rows: [{
        id: CASE_ID, user_id: OWNER_ID, status: 'resolved',
        violation_confirmed: true, violation_type: 't', license_plate: null,
        resolved_at: '2026-01-02T00:00:00Z',
      }] });
    const res = await request(app).patch(`/violations/${CASE_ID}/resolve`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolved');
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'CaseResolved' }));
  });
});

// ─── DELETE /violations/:id ──────────────────────────────────────────────────

describe('DELETE /violations/:id', () => {
  it('404s when case not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete(`/violations/${CASE_ID}`);
    expect(res.status).toBe(404);
  });

  it('403s for non-owner non-admin', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID, status: 'pending' }] });
    const res = await request(app).delete(`/violations/${CASE_ID}`).set('x-user-id', OTHER_ID);
    expect(res.status).toBe(403);
  });

  it('409s when already cancelled', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID, status: 'cancelled' }] });
    const res = await request(app).delete(`/violations/${CASE_ID}`).set('x-user-id', OWNER_ID);
    expect(res.status).toBe(409);
  });

  it('409s when already completed', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID, status: 'completed' }] });
    const res = await request(app).delete(`/violations/${CASE_ID}`).set('x-user-id', OWNER_ID);
    expect(res.status).toBe(409);
  });

  it('cancels successfully and audits', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID, status: 'pending' }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(app).delete(`/violations/${CASE_ID}`).set('x-user-id', OWNER_ID);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'CaseCancelled' }));
  });
});

// ─── /violations/:id/audit ───────────────────────────────────────────────────

describe('GET /violations/:id/audit', () => {
  it('404s when case missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/violations/${CASE_ID}/audit`);
    expect(res.status).toBe(404);
  });

  it('403s when caller is not owner', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] });
    const res = await request(app).get(`/violations/${CASE_ID}/audit`).set('x-user-id', OTHER_ID);
    expect(res.status).toBe(403);
  });

  it('returns events for the owner', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID }] });
    mockGetAuditLog.mockResolvedValue([{ event_type: 'CaseCreated' }]);
    const res = await request(app).get(`/violations/${CASE_ID}/audit`).set('x-user-id', OWNER_ID);
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.count).toBe(1);
  });
});

// ─── /violations/:id/similar ─────────────────────────────────────────────────

describe('GET /violations/:id/similar', () => {
  it('404s when case missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/violations/${CASE_ID}/similar`);
    expect(res.status).toBe(404);
  });

  it('403s when caller is not owner', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID, embedding: '[0.1,0.2]' }] });
    const res = await request(app).get(`/violations/${CASE_ID}/similar`).set('x-user-id', OTHER_ID);
    expect(res.status).toBe(403);
  });

  it('returns embedded:false when the source case has no embedding', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID, embedding: null }] });
    const res = await request(app).get(`/violations/${CASE_ID}/similar`).set('x-user-id', OWNER_ID);
    expect(res.status).toBe(200);
    expect(res.body.embedded).toBe(false);
    expect(res.body.results).toEqual([]);
  });

  it('returns similar cases when an embedding exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID, embedding: '[0.1]' }] });
    mockFindSimilarCases.mockResolvedValue([{ id: 'sim-1', distance: 0.1 }]);
    const res = await request(app).get(`/violations/${CASE_ID}/similar`).set('x-user-id', OWNER_ID);
    expect(res.status).toBe(200);
    expect(res.body.embedded).toBe(true);
    expect(res.body.count).toBe(1);
  });

  it('clamps the limit query param to [1,25]', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: OWNER_ID, embedding: '[0.1]' }] });
    mockFindSimilarCases.mockResolvedValue([]);
    const res = await request(app)
      .get(`/violations/${CASE_ID}/similar`)
      .query({ limit: '999' })
      .set('x-user-id', OWNER_ID);
    expect(res.status).toBe(200);
    expect(mockFindSimilarCases).toHaveBeenCalledWith(CASE_ID, 25);
  });
});

// ─── /sagas/:id ──────────────────────────────────────────────────────────────

describe('GET /sagas/:id', () => {
  it('404s when saga missing', async () => {
    mockGetSaga.mockResolvedValue(null);
    const res = await request(app).get('/sagas/abc');
    expect(res.status).toBe(404);
  });

  it('returns the saga state when present', async () => {
    mockGetSaga.mockResolvedValue({ id: 'abc', status: 'completed' });
    const res = await request(app).get('/sagas/abc');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });

  it('returns 500 on DB error', async () => {
    mockGetSaga.mockRejectedValue(new Error('db'));
    const res = await request(app).get('/sagas/abc');
    expect(res.status).toBe(500);
  });
});

// ─── /violations/audit/user/:userId ──────────────────────────────────────────

describe('GET /violations/audit/user/:userId', () => {
  it('returns events for the user with default pagination', async () => {
    mockGetAuditLogByUser.mockResolvedValue([{ event_type: 'CaseCreated' }]);
    const res = await request(app).get(`/violations/audit/user/${OWNER_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(mockGetAuditLogByUser).toHaveBeenCalledWith(OWNER_ID, 50, 0);
  });

  it('500s when the DB query rejects', async () => {
    mockGetAuditLogByUser.mockRejectedValue(new Error('db'));
    const res = await request(app).get(`/violations/audit/user/${OWNER_ID}`);
    expect(res.status).toBe(500);
  });
});

// ─── Multer error handler ────────────────────────────────────────────────────

describe('Multer error handling', () => {
  it('rejects an unsupported MIME type with 400 from fileFilter', async () => {
    const res = await request(app)
      .post('/violations/analyze')
      .field('userId', OWNER_ID)
      .attach('images', Buffer.from('hi'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid image type/);
  });
});
