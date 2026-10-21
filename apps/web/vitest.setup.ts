// Test setup.
//
// jest-dom's matchers (toBeInTheDocument, toBeDisabled, toHaveAttribute) read as
// assertions about what a person perceives rather than about a data structure,
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

/*
 * A ResizeObserver, for the charts.
 *
 * The chart components measure their container, because a chart that does not
 * know how wide it is cannot draw. visx does that with a ResizeObserver, and
 * jsdom has never implemented one -- so the chart's first render throws
 * "LocalResizeObserver is not a constructor", and the test fails on a missing
 * browser API rather than on the chart.
 *
 * The stub reports a size and then never changes, which is what a chart in a
 * fixed-width panel actually sees. It is not a simulation of ResizeObserver,
 * and it is not meant to be: it is the minimum a measurement needs.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  class TestResizeObserver implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = TestResizeObserver;
  // visx reads the LOCAL binding, which is why this has to be on the global
  // object's prototype chain rather than only on the global itself.
  if (typeof globalThis.window !== 'undefined') {
    (globalThis.window as unknown as { ResizeObserver: unknown }).ResizeObserver =
      TestResizeObserver;
  }
}
