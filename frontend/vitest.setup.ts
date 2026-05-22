import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Vitest does not auto-cleanup React Testing Library renders between tests
// the way Jest does. Without this, screen.getAllByRole() leaks DOM nodes
// across tests in the same file.
afterEach(() => {
  cleanup();
});
