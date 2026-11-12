import { devices, type BrowserContextOptions } from 'playwright';

/** Device projects used by check:layout, check:render, and check:mobile. */
export const mobileProjects: { name: string; browser: 'webkit' | 'chromium'; channel?: 'chrome'; context: BrowserContextOptions }[] = [
  { name: 'webkit-iphone', browser: 'webkit', context: devices['iPhone 13'] },
  { name: 'chromium-pixel', browser: 'chromium', channel: 'chrome', context: devices['Pixel 7'] },
  { name: 'webkit-ipad', browser: 'webkit', context: devices['iPad (gen 7)'] },
];
