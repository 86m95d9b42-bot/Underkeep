import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Most tests are pure rules and finish in milliseconds, but the generator
    // ones build hundreds of floors, and a floor of the deepest kind takes
    // about 27 ms. The default 5 s leaves them flaky on a busy machine.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
