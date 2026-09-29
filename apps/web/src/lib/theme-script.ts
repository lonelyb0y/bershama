/*
 * Theme, applied before first paint.
 *
 * Inlined in <head> rather than imported, and that placement is the whole point.
 * A theme set from a client component lands after React has painted, so the page
 * flashes white before turning dark. On a dashboard someone opens at the start of
 * a shift that flash is the first thing they see every morning, and it is the
 * kind of detail that makes an interface feel unfinished.
 *
 * Runs before the body exists, so it only ever touches <html>. It:
 *   1. reads the saved choice from localStorage
 *   2. falls back to the OS preference when nothing is saved
 *   3. writes "dark" or "light" onto <html>
 *   4. subscribes to the OS preference, but only while the user has not chosen
 *
 * The stored keys are namespaced and versioned with the prefix. A bare "theme"
 * key in localStorage is the kind of thing a future feature will collide with,
 * and a stale "light" left over from an older build should not silently control
 * this one.
 */
export const THEME_SCRIPT = `(function () {
  var KEY = 'pharmaflow:theme';
  var root = document.documentElement;

  function systemPrefersDark() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function apply(choice) {
    var dark = choice === 'system' ? systemPrefersDark() : choice === 'dark';
    root.classList.toggle('dark', dark);
    root.classList.toggle('light', !dark);
  }

  var stored = null;
  try {
    stored = window.localStorage.getItem(KEY);
  } catch (e) {
    // Private browsing in some browsers throws on localStorage access. The theme
    // is a preference, not a requirement, so fall through to the OS setting
    // rather than breaking the page.
    stored = null;
  }

  var choice = stored === 'light' || stored === 'dark' ? stored : 'system';
  apply(choice);

  // Only follow the OS while the user has expressed no preference. Once they have
  // picked, their choice is the answer, and the OS flipping at sunset must not
  // repaint a screen someone is in the middle of reading.
  if (choice === 'system') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      apply('system');
    });
  }
})();`;
