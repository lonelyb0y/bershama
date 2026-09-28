// Test setup.
//
// jest-dom's matchers (toBeInTheDocument, toBeDisabled, toHaveAttribute) read as
// assertions about what a user perceives rather than about a data structure,
// which is the right altitude for component tests. Registered globally so a new
// file cannot be blocked from using them by forgetting an import.

import '@testing-library/jest-dom/vitest';

import { afterEach } from 'vitest';

// Unmount between tests -- but only where there is a DOM.
//
// Testing Library auto-cleans when the framework exposes a global afterEach,
// which vitest does not unless `globals: true` is set, and that is not on.
// Without this, five tests failed at once with "Found multiple elements" and one
// asserted against a previous test's leftover DOM -- which is how a suite starts
// reporting failures that have nothing to do with the code under test.
//
// The guard is load-bearing, not defensive: this file runs for the pure-logic
// tests too, and importing @testing-library/react in a node environment pulls in
// a DOM that does not exist.
if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  afterEach(cleanup);
}
