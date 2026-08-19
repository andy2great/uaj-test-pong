import { defineConfig } from 'vitest/config';

// PAGES_BASE is set by the web-deploy workflow (/<repo-name>/) so assets
// resolve under GitHub Pages project sites. Local dev and the Capacitor
// build both need relative paths.
let base = './';
if (process.env.PAGES_BASE) {
  base = process.env.PAGES_BASE;
}

export default defineConfig({
  base,
  test: {
    environment: 'node',
  },
});
