import { describe, it, expect, jest } from '@jest/globals';

// Cover the env-fallback condition arms in db.js (host || 'localhost' etc).
// We have to mock pg before importing so no real connection is attempted.
await jest.unstable_mockModule('pg', () => ({
  default: {
    Pool: class FakePool {
      constructor(cfg) { this.cfg = cfg; }
      query()           { return Promise.resolve({ rows: [], rowCount: 0 }); }
      on()              {}
    },
  },
}));

// Wipe the env so every `||` fallback in the pool config evaluates its
// right-hand side — this is the only path that covers those condition arms.
delete process.env.DB_HOST;
delete process.env.DB_PORT;
delete process.env.DB_NAME;
delete process.env.DB_USER;
delete process.env.DB_PASSWORD;

const db = await import('../../src/db.js');

describe('db.js env fallbacks', () => {
  it('exports a query function that resolves under the fake pool', async () => {
    const r = await db.query('SELECT 1');
    expect(r.rows).toEqual([]);
  });
});
