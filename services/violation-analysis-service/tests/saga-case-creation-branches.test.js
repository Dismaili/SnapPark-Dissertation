import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use the real buildCaseCreationSteps but feed each step manually so the
// individual branches (e.g. embedAndIndex's "no text" path, the
// dispatchNotification compensation try/catch) are all covered.

const mockQuery               = vi.fn();
const mockInsertCaseImages    = vi.fn().mockResolvedValue();
const mockAuditLog            = vi.fn().mockResolvedValue();
const mockSetCaseEmbedding    = vi.fn().mockResolvedValue();
const mockClearCaseEmbedding  = vi.fn().mockResolvedValue();
const mockPublishStrict       = vi.fn();
const mockGenerateEmbedding   = vi.fn();
const mockRunSaga             = vi.fn();

vi.mock('../src/db.js', () => ({
  query:              (...a) => mockQuery(...a),
  insertCaseImages:   (...a) => mockInsertCaseImages(...a),
  auditLog:           (...a) => mockAuditLog(...a),
  setCaseEmbedding:   (...a) => mockSetCaseEmbedding(...a),
  clearCaseEmbedding: (...a) => mockClearCaseEmbedding(...a),
}));

vi.mock('../src/rabbitmq.js', () => ({
  publishStrict: (...a) => mockPublishStrict(...a),
}));

vi.mock('../src/embeddings.js', () => ({
  generateEmbedding:   (...a) => mockGenerateEmbedding(...a),
  buildEmbeddingInput: ({ violationType, explanation, licensePlate }) => {
    const parts = [];
    if (violationType) parts.push(`Violation: ${violationType}.`);
    if (explanation)   parts.push(`Explanation: ${explanation}`);
    if (licensePlate)  parts.push(`Plate: ${licensePlate}.`);
    return parts.join(' ').trim();
  },
}));

vi.mock('../src/saga/coordinator.js', () => ({
  runSaga: (...a) => mockRunSaga(...a),
}));

const { buildCaseCreationSteps, runCaseCreationSaga } = await import('../src/saga/caseCreationSaga.js');

const baseContext = {
  userId: 'u',
  userEmail: 'u@x.c',
  imageDetails: [{ base64: 'a', mimeType: 'image/jpeg', sizeBytes: 10, buffer: Buffer.from('a'), qualityStats: {} }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildCaseCreationSteps — individual step branches', () => {
  const analyser = {
    analyseImage:          vi.fn().mockResolvedValue({ violationConfirmed: true, violationType: 't', confidence: 0.9, explanation: 'e' }),
    analyseMultipleImages: vi.fn().mockResolvedValue({ violationConfirmed: true, violationType: 't', confidence: 0.9, explanation: 'e' }),
  };

  it('stepAnalyzeImage uses analyseImage for a single image', async () => {
    const steps = buildCaseCreationSteps({ analyser });
    const result = await steps[0].execute(baseContext);
    expect(result.analysis.violationConfirmed).toBe(true);
    expect(analyser.analyseImage).toHaveBeenCalled();
    expect(analyser.analyseMultipleImages).not.toHaveBeenCalled();
  });

  it('stepAnalyzeImage uses analyseMultipleImages for >1 images', async () => {
    analyser.analyseImage.mockClear();
    analyser.analyseMultipleImages.mockClear();
    const steps = buildCaseCreationSteps({ analyser });
    await steps[0].execute({
      ...baseContext,
      imageDetails: [
        { base64: 'a', mimeType: 'image/jpeg', sizeBytes: 10, buffer: Buffer.from('a') },
        { base64: 'b', mimeType: 'image/png',  sizeBytes: 20, buffer: Buffer.from('b') },
      ],
    });
    expect(analyser.analyseMultipleImages).toHaveBeenCalled();
  });

  it('stepPersistCase inserts and returns the saved row', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'case-1', user_id: 'u' }] });
    const steps = buildCaseCreationSteps({ analyser });
    const r = await steps[1].execute({ ...baseContext, analysis: { violationConfirmed: true, violationType: 't', confidence: 0.9, explanation: 'e' } });
    expect(r.savedCase.id).toBe('case-1');
  });

  it('stepPersistCase compensation deletes the case row when ID exists', async () => {
    const steps = buildCaseCreationSteps({ analyser });
    await steps[1].compensate({ savedCase: { id: 'case-1' } });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/DELETE FROM cases/), ['case-1']);
  });

  it('stepPersistCase compensation is a no-op without saved ID', async () => {
    const steps = buildCaseCreationSteps({ analyser });
    await steps[1].compensate({ savedCase: null });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('stepPersistImages compensation deletes images by case_id when ID exists', async () => {
    const steps = buildCaseCreationSteps({ analyser });
    await steps[2].compensate({ savedCase: { id: 'c' } });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/DELETE FROM case_images/), ['c']);
  });

  it('stepPersistImages compensation is no-op when ID missing', async () => {
    const steps = buildCaseCreationSteps({ analyser });
    await steps[2].compensate({ savedCase: null });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('stepEmbedAndIndex skips when there is no text to embed', async () => {
    const steps = buildCaseCreationSteps({ analyser });
    const r = await steps[3].execute({
      ...baseContext,
      savedCase: { id: 'c', violation_type: null, explanation: '', license_plate: null },
    });
    expect(r.embedded).toBe(false);
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  it('stepEmbedAndIndex sets the embedding when text exists', async () => {
    mockGenerateEmbedding.mockResolvedValue(new Array(768).fill(0.1));
    const steps = buildCaseCreationSteps({ analyser });
    const r = await steps[3].execute({
      ...baseContext,
      savedCase: { id: 'c', violation_type: 't', explanation: 'e', license_plate: null },
    });
    expect(r.embedded).toBe(true);
    expect(mockSetCaseEmbedding).toHaveBeenCalled();
  });

  it('stepEmbedAndIndex compensation clears the embedding when ID exists', async () => {
    const steps = buildCaseCreationSteps({ analyser });
    await steps[3].compensate({ savedCase: { id: 'c' }, sagaId: 's' });
    expect(mockClearCaseEmbedding).toHaveBeenCalledWith('c');
  });

  it('stepEmbedAndIndex compensation swallows clear errors', async () => {
    mockClearCaseEmbedding.mockRejectedValueOnce(new Error('boom'));
    const steps = buildCaseCreationSteps({ analyser });
    await expect(steps[3].compensate({ savedCase: { id: 'c' }, sagaId: 's' })).resolves.toBeUndefined();
  });

  it('stepEmbedAndIndex compensation no-op without case ID', async () => {
    const steps = buildCaseCreationSteps({ analyser });
    await steps[3].compensate({ savedCase: null, sagaId: 's' });
    expect(mockClearCaseEmbedding).not.toHaveBeenCalled();
  });

  it('stepRecordAuditCreated writes a CaseCreated entry', async () => {
    const steps = buildCaseCreationSteps({ analyser });
    await steps[4].execute({
      ...baseContext,
      savedCase: { id: 'c', user_id: 'u', violation_confirmed: true, violation_type: 't', confidence: 0.9, image_count: 1 },
      sagaId: 's',
    });
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'CaseCreated' }));
  });

  it('stepRecordAuditCreated compensation logs CaseCreationCompensated', async () => {
    const steps = buildCaseCreationSteps({ analyser });
    await steps[4].compensate({ savedCase: { id: 'c' }, userId: 'u', sagaId: 's' });
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'CaseCreationCompensated' }));
  });

  it('stepDispatchNotification publishes case.created', async () => {
    const steps = buildCaseCreationSteps({ analyser });
    await steps[5].execute({
      ...baseContext,
      savedCase: { id: 'c', user_id: 'u', violation_confirmed: true, violation_type: 't', confidence: 0.9, explanation: 'e', license_plate: null, image_count: 1, created_at: 'now' },
      sagaId: 's',
    });
    expect(mockPublishStrict).toHaveBeenCalledWith('case.created', expect.objectContaining({ id: 'c' }));
  });

  it('stepDispatchNotification compensation publishes case.cancelled and swallows broker errors', async () => {
    mockPublishStrict.mockImplementationOnce(() => { throw new Error('broker down'); });
    const steps = buildCaseCreationSteps({ analyser });
    await expect(steps[5].compensate({ savedCase: { id: 'c', user_id: 'u' }, sagaId: 's' })).resolves.toBeUndefined();
  });

  it('runCaseCreationSaga delegates to runSaga with the case-creation step list', async () => {
    mockRunSaga.mockResolvedValue({ savedCase: { id: 'c' }, sagaId: 's' });
    const r = await runCaseCreationSaga({ context: baseContext, analyser });
    expect(mockRunSaga).toHaveBeenCalledWith(expect.objectContaining({ sagaType: 'case-creation' }));
    expect(r.sagaId).toBe('s');
  });
});
