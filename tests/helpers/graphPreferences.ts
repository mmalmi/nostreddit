import type { BrowserContext } from '@playwright/test';

// Isolated relay fixtures use new signing keys outside the bundled graph.
export function allowFixtureAuthors(context: BrowserContext) {
  return context.addInitScript(() => {
    const key = 'nostreddit.ui.graphVisibility';
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify({maxDistance: null, hideOvermuted: false}));
    }
  });
}
