// Single jest globalTeardown for the integration project: closes the shared
// pg pool once *all* integration test files have finished. The pool is
// imported by multiple files (auth.test.js, profile.test.js, …) and they
// all share the same Pool instance, so we cannot call pool.end() inside any
// one file's afterAll without breaking the rest.
import pool from '../../src/db.js';

export default async function teardown() {
  await pool.end();
}
