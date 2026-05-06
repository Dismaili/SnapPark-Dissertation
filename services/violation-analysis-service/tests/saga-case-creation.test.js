import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the modules the saga steps reach into. The coordinator itself
// reaches into db.query for state persistence — we route those calls
// through the same mock and disambiguate by SQL text.
const mockQuery               = vi.fn();
const mockInsertCaseImages    = vi.fn();
const mockAuditLog            = vi.fn();
const mockSetCaseEmbedding    = vi.fn();
const mockClearCaseEmbedding  = vi.fn();
const mockPublishStrict       = vi.fn();
const mockGenerateEmbedding   = vi.fn();

vi.mock('../src/db.js', () => ({
  query:               mockQuery,
  insertCaseImages:    mockInsertCaseImages,
  auditLog:            mockAuditLog,
  setCaseEmbedding:    mockSetCaseEmbedding,
  clearCaseEmbedding:  mockClearCaseEmbedding,
  // EMBEDDING_DIM is read by embeddings.js at import time. We don't go
  // through embeddings.js in these tests (it's mocked below), but we
  // still export the constant so unrelated import paths don't blow up.
  EMBEDDING_DIM:       768,
}));

vi.mock('../src/rabbitmq.js', () => ({
  publishStrict: mockPublishStrict,
}));

vi.mock('../src/embeddings.js', () => ({
  generateEmbedding:    mockGenerateEmbedding,
  buildEmbeddingInput:  ({ violationType, explanation, licensePlate }) =>
    [violationType, explanation, licensePlate].filter(Boolean).join(' '),
}));

const { runCaseCreationSaga } = await import('../src/saga/caseCreationSaga.js');

const SAGA_ID = '22222222-2222-2222-2222-222222222222';
const CASE_ID = 'case-abc';

const makeContext = () => ({
  userId:       'user-1',
  userEmail:    'u@example.com',
  licensePlate: 'XYZ-123',
  latitude:     null,
  longitude:    null,
  locationLabel: null,
  imageDetails: [
    {
      buffer:   Buffer.from('img-bytes'),
      base64:   'aW1nLWJ5dGVz',
      mimeType: 'image/jpeg',
      sizeBytes: 9,
      qualityStats: {},
    },
  ],
});

const stubAnalyser = {
  analyseImage: vi.fn().mockResolvedValue({
    violationConfirmed: true,
    violationType:      'ParkingOnZebra',
    confidence:         0.92,
    explanation:        'Vehicle is on a zebra crossing.',
  }),
  analyseMultipleImages: vi.fn(),
};

const setupHappyPathQueries = () => {
  mockQuery.mockImplementation((sql) => {
    if (/INSERT INTO sagas/i.test(sql)) {
      return Promise.resolve({ rows: [{ id: SAGA_ID }] });
    }
    if (/INSERT INTO cases/i.test(sql)) {
      return Promise.resolve({
        rows: [{
          id:                 CASE_ID,
          user_id:            'user-1',
          status:             'completed',
          violation_confirmed: true,
          violation_type:     'ParkingOnZebra',
          confidence:         0.92,
          explanation:        'Vehicle is on a zebra crossing.',
          license_plate:      'XYZ-123',
          image_count:        1,
          created_at:         '2026-05-07T00:00:00Z',
        }],
      });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
};

const compensationSqls = () =>
  mockQuery.mock.calls
    .map(([sql]) => sql)
    .filter((s) => /^\s*DELETE\s+FROM/i.test(s));

describe('caseCreationSaga — happy path', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockInsertCaseImages.mockReset();
    mockAuditLog.mockReset();
    mockSetCaseEmbedding.mockReset();
    mockClearCaseEmbedding.mockReset();
    mockClearCaseEmbedding.mockResolvedValue(undefined);
    mockSetCaseEmbedding.mockResolvedValue(undefined);
    mockPublishStrict.mockReset();
    mockGenerateEmbedding.mockReset();
    stubAnalyser.analyseImage.mockClear();

    setupHappyPathQueries();
    mockGenerateEmbedding.mockResolvedValue(new Array(768).fill(0.01));
  });

  it('runs every step and publishes case.created exactly once', async () => {
    const result = await runCaseCreationSaga({
      analyser: stubAnalyser,
      context:  makeContext(),
    });

    expect(stubAnalyser.analyseImage).toHaveBeenCalledTimes(1);
    expect(mockInsertCaseImages).toHaveBeenCalledTimes(1);
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
    expect(mockSetCaseEmbedding).toHaveBeenCalledWith(CASE_ID, expect.any(Array));
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'CaseCreated',
      caseId:    CASE_ID,
    }));
    expect(mockPublishStrict).toHaveBeenCalledWith(
      'case.created',
      expect.objectContaining({ id: CASE_ID, sagaId: SAGA_ID }),
    );

    // No compensations should have run on the happy path.
    expect(compensationSqls()).toHaveLength(0);
    expect(mockClearCaseEmbedding).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'CaseCreationCompensated',
    }));

    expect(result.savedCase.id).toBe(CASE_ID);
    expect(result.analysis.violationConfirmed).toBe(true);
    expect(result.embedded).toBe(true);
  });

  it('still completes the saga when the case has no embeddable text', async () => {
    // Strip explanation, licensePlate, and violationType so buildEmbeddingInput
    // returns the empty string. The step short-circuits without calling the
    // embedding API or touching the embedding column.
    mockQuery.mockImplementation((sql) => {
      if (/INSERT INTO sagas/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: SAGA_ID }] });
      }
      if (/INSERT INTO cases/i.test(sql)) {
        return Promise.resolve({
          rows: [{
            id:                  CASE_ID,
            user_id:             'user-1',
            status:              'completed',
            violation_confirmed: false,
            violation_type:      null,
            confidence:          0.0,
            explanation:         '',
            license_plate:       null,
            image_count:         1,
            created_at:          '2026-05-07T00:00:00Z',
          }],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await runCaseCreationSaga({
      analyser: {
        analyseImage: vi.fn().mockResolvedValue({
          violationConfirmed: false,
          violationType:      null,
          confidence:         0,
          explanation:        '',
        }),
        analyseMultipleImages: vi.fn(),
      },
      context: makeContext(),
    });

    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockSetCaseEmbedding).not.toHaveBeenCalled();
    expect(result.embedded).toBe(false);
  });
});

describe('caseCreationSaga — compensations', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockInsertCaseImages.mockReset();
    mockAuditLog.mockReset();
    mockSetCaseEmbedding.mockReset();
    mockClearCaseEmbedding.mockReset();
    mockClearCaseEmbedding.mockResolvedValue(undefined);
    mockSetCaseEmbedding.mockResolvedValue(undefined);
    mockPublishStrict.mockReset();
    mockGenerateEmbedding.mockReset();
    mockGenerateEmbedding.mockResolvedValue(new Array(768).fill(0.01));
    stubAnalyser.analyseImage.mockClear();
  });

  it('rolls everything back when embedding generation fails', async () => {
    setupHappyPathQueries();
    mockGenerateEmbedding.mockReset();
    mockGenerateEmbedding.mockRejectedValueOnce(new Error('embedding API down'));

    await expect(
      runCaseCreationSaga({ analyser: stubAnalyser, context: makeContext() })
    ).rejects.toMatchObject({ failedStep: 'embedAndIndex', compensated: true });

    // The case row + image rows must be cleaned up (LIFO from the
    // completed steps before embedAndIndex).
    const deletes = compensationSqls();
    expect(deletes.some((s) => /DELETE FROM case_images/i.test(s))).toBe(true);
    expect(deletes.some((s) => /DELETE FROM cases/i.test(s))).toBe(true);

    // Notification must NOT have fired — the saga aborted before step 6.
    expect(mockPublishStrict).not.toHaveBeenCalledWith('case.created', expect.anything());
  });

  it('rolls the case INSERT back when persistImages fails', async () => {
    setupHappyPathQueries();
    mockInsertCaseImages.mockRejectedValueOnce(new Error('disk full'));

    await expect(
      runCaseCreationSaga({ analyser: stubAnalyser, context: makeContext() })
    ).rejects.toMatchObject({ failedStep: 'persistImages', compensated: true });

    // case-images compensation deletes by case_id, then case compensation
    // deletes the parent. Order: images first (LIFO of completed steps),
    // but persistImages didn't complete, so only persistCase compensates.
    const deletes = compensationSqls();
    expect(deletes.length).toBeGreaterThan(0);
    expect(deletes.some((s) => /DELETE FROM cases/i.test(s))).toBe(true);

    // Notification publish must NOT have happened because we never reached step 5.
    expect(mockPublishStrict).not.toHaveBeenCalledWith('case.created', expect.anything());
  });

  it('rolls everything back when the audit step fails', async () => {
    setupHappyPathQueries();
    mockAuditLog.mockImplementationOnce(async ({ eventType }) => {
      if (eventType === 'CaseCreated') throw new Error('audit table locked');
    });

    await expect(
      runCaseCreationSaga({ analyser: stubAnalyser, context: makeContext() })
    ).rejects.toMatchObject({ failedStep: 'recordAuditCreated', compensated: true });

    const deletes = compensationSqls();
    // Both image rows AND the parent case row must be cleaned up — the
    // case_images compensation runs first (LIFO), then cases.
    expect(deletes.some((s) => /DELETE FROM case_images/i.test(s))).toBe(true);
    expect(deletes.some((s) => /DELETE FROM cases/i.test(s))).toBe(true);

    // The audit step ITSELF failed forward, so its compensation does NOT
    // run (compensations only fire for steps that completed). The
    // CaseCreationCompensated entry is therefore not written here —
    // that entry only appears when a LATER step (e.g. dispatchNotification)
    // is the one that fails. Asserting the negative is what makes this
    // test catch a regression where a saga starts compensating its own
    // failed step.
    expect(mockAuditLog).not.toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'CaseCreationCompensated',
    }));
  });

  it('rolls everything back when notification dispatch fails', async () => {
    setupHappyPathQueries();
    mockPublishStrict.mockImplementationOnce(() => {
      throw new Error('rabbitmq unavailable');
    });

    await expect(
      runCaseCreationSaga({ analyser: stubAnalyser, context: makeContext() })
    ).rejects.toMatchObject({ failedStep: 'dispatchNotification', compensated: true });

    // case.cancelled compensation publish runs (best-effort) — even if it
    // throws, compensation should continue.
    const deletes = compensationSqls();
    expect(deletes.some((s) => /DELETE FROM case_images/i.test(s))).toBe(true);
    expect(deletes.some((s) => /DELETE FROM cases/i.test(s))).toBe(true);

    // Audit-log compensation must have appended the rollback entry.
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'CaseCreationCompensated',
    }));
  });

  it('does NOT touch the database when Gemini analysis fails (no state to compensate)', async () => {
    setupHappyPathQueries();
    stubAnalyser.analyseImage.mockRejectedValueOnce(new Error('gemini quota exceeded'));

    await expect(
      runCaseCreationSaga({ analyser: stubAnalyser, context: makeContext() })
    ).rejects.toMatchObject({ failedStep: 'analyzeImage', compensated: true });

    // No case row was inserted, so no compensation should have run.
    expect(compensationSqls()).toHaveLength(0);
    expect(mockInsertCaseImages).not.toHaveBeenCalled();
    expect(mockPublishStrict).not.toHaveBeenCalled();
  });
});
