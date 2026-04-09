import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the db module
const mockQuery = vi.fn();
vi.mock('../src/db.js', () => ({
  query: mockQuery,
}));

const { startCleanupJob, stopCleanupJob } = await import('../src/cleanup.js');

describe('Cleanup Job (FR7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopCleanupJob();
    vi.useRealTimers();
  });

  it('should expire stale pending cases', async () => {
    mockQuery.mockResolvedValue({
      rowCount: 2,
      rows: [
        { id: 'case-1', user_id: 'user-1', created_at: '2024-01-01' },
        { id: 'case-2', user_id: 'user-2', created_at: '2024-01-01' },
      ],
    });

    startCleanupJob();

    // Allow the immediate run to complete
    await vi.advanceTimersByTimeAsync(0);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("SET status = 'expired'");
    expect(sql).toContain("WHERE status = 'pending'");
    expect(params[0]).toBe(24); // default EXPIRY_THRESHOLD_HOURS
  });

  it('should handle no stale cases gracefully', async () => {
    mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });

    startCleanupJob();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('should handle database errors without crashing', async () => {
    mockQuery.mockRejectedValue(new Error('Connection refused'));

    startCleanupJob();
    await vi.advanceTimersByTimeAsync(0);

    // Should not throw — error is caught internally
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('should run periodically on interval', async () => {
    mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });

    startCleanupJob();
    await vi.advanceTimersByTimeAsync(0);

    // Advance past one interval (default 1 hour = 3600000ms)
    await vi.advanceTimersByTimeAsync(3600000);

    expect(mockQuery).toHaveBeenCalledTimes(2); // initial + 1 interval
  });

  it('should stop when stopCleanupJob is called', async () => {
    mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });

    startCleanupJob();
    await vi.advanceTimersByTimeAsync(0);

    stopCleanupJob();

    await vi.advanceTimersByTimeAsync(3600000);

    // Should still be 1 (only the initial run)
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
