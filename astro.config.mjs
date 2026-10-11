// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://meltandbox.pages.dev',
  output: 'static',
  trailingSlash: 'ignore',
  // Instant navigation: prefetch links on hover / when visible.
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  build: {
    // CSS is small — inline it so there are no render-blocking stylesheet requests.
    inlineStylesheets: 'always',
    format: 'directory',
  },
  image: {
    // Product photos are ≤720px; never generate bigger files.
    breakpoints: [240, 360, 480, 720],
  },
});
