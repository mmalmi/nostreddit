import { expect, test, type Page } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { allowFixtureAuthors } from './helpers/graphPreferences';

const owner = getPublicKey(generateSecretKey());
const subject = getPublicKey(generateSecretKey());
const followers = Array.from({ length: 6 }, () => getPublicKey(generateSecretKey()));
const post = finalizeEvent({ kind: 1, content: 'A discussion arriving shortly', created_at: Math.floor(Date.now()/1000),
  tags: [['subject', 'A discussion arriving shortly'], ['t', 'loading-check']] }, generateSecretKey());

// Keep relay connection status independent of content, as on a real first visit.
// These workers never connect to public relays or load the optional AI model.
async function controlledWorkers(page: Page, options: { content?: 'feed' | 'comments' | 'notifications'; following?: number | null; offline?: boolean } = {}) {
  await allowFixtureAuthors(page.context());
  await page.addInitScript(() => {
    localStorage.setItem('nostreddit.ui.relatedSearch', 'false');
    localStorage.setItem('nostreddit.ui.hot', JSON.stringify({ connectionStrength: false }));
  });
  const reply = finalizeEvent({ kind: 1, content: 'An arriving comment', created_at: post.created_at,
    tags: [['e', post.id, '', 'root'], ['p', post.pubkey]] }, generateSecretKey());
  const mention = finalizeEvent({ kind: 1, content: 'An arriving notification', created_at: post.created_at,
    tags: [['p', owner]] }, generateSecretKey());
  await page.route('**/relay.worker-*.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    let started = false;
    self.onmessage = ({data}) => {
      if (data.type === 'watch' && !started) {
        started = true;
        self.postMessage({type:'status',value:'live'});
        ${options.offline ? "setTimeout(() => self.postMessage({type:'status',value:'offline'}), 300);" : ''}
        ${options.content === 'comments' ? `self.postMessage({type:'events',events:[${JSON.stringify(post)}]});` : ''}
        ${options.content ? `setTimeout(() => self.postMessage({type:'events',events:${JSON.stringify([options.content === 'feed' ? post : options.content === 'comments' ? reply : mention])}}), 700);` : ''}
      }
      if (['contacts','latest','search'].includes(data.type)) self.postMessage({type:'result',id:data.id,events:[]});
    };
  ` }));
  await page.route('**/graph-worker-*.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    self.onmessage = ({data}) => {
      if ('relays' in data || 'syncActive' in data) return;
      self.postMessage({version:data.version,
      discoveryRoot:'4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0',
      badges:Object.fromEntries(data.authors.map(key => [key,{distance:2,muted:false,overmuted:false,followedByFriends:1}])),
      profile:data.profile ? {subject:data.profile,viewer:data.root,followers:6,following:${options.following ?? 'null'},
        followingFromList:${options.following != null},followsViewer:false,mutuals:[],mutualCount:0,
        directory:data.directory ? {kind:data.directory,keys:data.directory === 'followers' ? ${JSON.stringify(followers)} : [],
          known:data.directory === 'followers' || ${options.following != null}} : null} : null});
    };
  ` }));
}

async function signIn(page: Page) {
  await page.addInitScript(pubkey => localStorage.setItem('nostreddit.account.v1', JSON.stringify({pubkey, method:'extension'})), owner);
}

async function recordEmptyFlashes(page: Page, selector: string) {
  await page.addInitScript(selector => {
    const flashes: string[] = [];
    Object.assign(window, { emptyFlashes: flashes });
    function sample() {
      for (const node of document.querySelectorAll(selector)) {
        const style = getComputedStyle(node);
        if (style.visibility !== 'hidden' && Number(style.opacity) > 0 && node.getBoundingClientRect().height) flashes.push(node.textContent || '');
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }, selector);
}

test.use({ serviceWorkers: 'block' });

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`slow page loading waits two seconds, then reveals (${reducedMotion})`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion });
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/SettingsPage-*.js', async route => { await pending; await route.continue(); });
    try {
      await page.goto('/settings', { waitUntil: 'domcontentloaded' });
      const loading = page.locator('[data-route-active="true"] .loading-state').filter({ hasText: 'Loading…' });
      await expect(loading).toBeAttached();
      await expect(loading).toBeHidden();
      await expect(loading).toHaveCSS('animation-delay', '2s');
      await expect(loading).toHaveCSS('animation-duration', reducedMotion === 'reduce' ? '0.001s' : '0.18s');
      await page.waitForTimeout(1200);
      await expect(loading).toBeHidden();
      await expect(loading).toBeVisible({ timeout: 2000 });
      await page.screenshot({ path: info.outputPath(`slow-loading-${reducedMotion}.png`) });
      release();
      await expect(page.getByLabel('Maximum follow distance')).toBeVisible();
      await expect(loading).toHaveCount(0);
    } finally { release(); }
  });
}

test('a fast page never shows the placeholder and a failed page shows its error immediately', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/SettingsPage-*.js', async route => { await pending; await route.continue(); });
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  const loading = page.locator('[data-route-active="true"] .loading-state').filter({ hasText: 'Loading…' });
  await expect(loading).toBeAttached();
  await expect(loading).toBeHidden();
  release();
  await expect(page.getByLabel('Maximum follow distance')).toBeVisible();
  await expect(loading).toHaveCount(0);
  await page.route('**/ProfileConnections-*.js', route => route.abort());
  await page.goto('/u/' + 'a'.repeat(64) + '/following', { waitUntil: 'domcontentloaded' });
  const error = page.getByRole('alert').filter({ hasText: 'Could not load this page.' });
  await expect(error).toBeVisible({ timeout: 1500 });
  await expect(error).toHaveCSS('animation-name', 'none');
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`an empty connected feed keeps its two-second delay through status changes (${reducedMotion})`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: reducedMotion === 'reduce' ? 390 : 1440, height: 900 });
    await controlledWorkers(page, { offline: true });
    await page.goto('/');
    const empty = page.locator('[data-route-active="true"] .feed-list .empty');
    await expect(empty).toContainText('No discussions loaded yet');
    await expect(empty).toBeHidden();
    await expect(empty).toContainText('Relays are offline');
    await expect(empty).toBeHidden();
    await expect(empty).toHaveCSS('animation-delay', '2s');
    await page.waitForTimeout(800);
    await expect(empty).toBeHidden();
    await page.screenshot({ path: info.outputPath('empty-feed-before-delay.png') });
    await expect(empty).toBeVisible({ timeout: 2000 });
    await page.screenshot({ path: info.outputPath('empty-feed-after-delay.png') });
  });
}

for (const [name, path] of [['topic', '/t/loading-check'], ['network', '/network'], ['search', '/search?q=missing'], ['following', '/following'], ['profile', '/u/' + subject]]) {
  test(`data-dependent empty state waits on ${name}`, async ({ page }) => {
    await controlledWorkers(page);
    await signIn(page);
    await page.goto(path);
    const empty = page.locator('[data-route-active="true"] .feed-list .empty');
    await expect(empty).toBeAttached();
    await expect(empty).toBeHidden();
    await expect(empty).toHaveCSS('animation-delay', '2s');
    await expect(empty).toBeVisible({ timeout: 3000 });
  });
}

for (const content of ['feed', 'comments', 'notifications'] as const) {
  test(`fast ${content} arrive without flashing an empty message`, async ({ page }) => {
    await controlledWorkers(page, { content });
    if (content === 'notifications') await signIn(page);
    const selector = content === 'comments' ? '.discussion > .quiet' : content === 'feed' ? '.feed-list .empty' : 'main > .empty';
    await recordEmptyFlashes(page, selector);
    await page.goto(content === 'comments' ? '/post/' + post.id : content === 'notifications' ? '/notifications' : '/');
    await expect(page.locator(selector)).toBeAttached();
    await expect(page.locator(selector)).toBeHidden();
    await expect(page.getByText(content === 'feed' ? post.content : content === 'comments' ? 'An arriving comment' : 'An arriving notification', { exact: true })).toBeVisible();
    await expect(page.locator(selector)).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { emptyFlashes: string[] }).emptyFlashes)).toEqual([]);
  });
}

test('known local empty states and guest sign-in prompts stay immediate', async ({ page }) => {
  await controlledWorkers(page);
  for (const [path, text] of [['/saved', 'No saved posts yet'], ['/following', 'Your following feed'], ['/notifications', 'Your notifications']]) {
    await page.goto(path);
    const heading = page.getByRole('heading', { name: text, exact: true });
    await expect(heading).toBeVisible({ timeout: 1500 });
    await expect(heading.locator('..')).toHaveCSS('animation-name', 'none');
  }
});

for (const following of [null, 0]) {
  test(`profile distinguishes ${following === null ? 'unknown' : 'empty'} follow lists and total followers`, async ({ page }, info) => {
    await controlledWorkers(page, { following });
    await page.goto('/u/' + subject);
    await expect(page.getByRole('link', { name: 'View following', exact: true })).toHaveText(`${following === null ? '—' : '0'} Following`);
    await expect(page.getByRole('link', { name: 'View followers', exact: true })).toHaveText('6 Followers');
    await expect(page.locator('.social-context summary')).toHaveText('Two follow steps away in the public graph.');
    await expect(page.locator('h1').getByTestId('social-distance-badge')).toHaveAttribute('title', 'Two follow steps away in the public graph');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('profile-counts-mobile.png') });
    await page.getByRole('link', { name: 'View following', exact: true }).click();
    const state = page.locator('.connections > .state');
    await expect(state).toBeAttached();
    await expect(state).toBeHidden();
    await expect(state).toHaveCSS('animation-delay', '2s');
    await expect(state).toBeVisible({ timeout: 3000 });
    await page.getByRole('navigation', { name: 'Relationship lists' }).getByRole('link', { name: 'Followers', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Followers', exact: true }).getByRole('listitem')).toHaveCount(6);
  });
}
