import {expect, test} from './helpers/isolatedBrowser';
import {allowFixtureAuthors} from './helpers/graphPreferences';
import {Relay} from 'nostr-tools/relay';
import {finalizeEvent, generateSecretKey, getPublicKey} from 'nostr-tools/pure';
import {profileUrl} from '../src/lib/profile-url';
import {postUrl} from '../src/lib/post-url';

for (const width of [390, 1280]) {
  test(`late translation keeps the discussion still at ${width}px`, async ({page, context}, info) => {
    await page.setViewportSize({width, height: 820});
    await allowFixtureAuthors(context);
    await page.addInitScript(() => {
      // Runs again on reload, where saved changes must survive.
      if (!localStorage.getItem('reading-translation-v1')) localStorage.setItem('reading-translation-v1', JSON.stringify({auto:true, target:'en', read:['fi']}));
      let release!: () => void;
      const gate = new Promise<void>(resolve => release = resolve);
      Object.assign(window, {
        finishTranslation: release,
        LanguageDetector: {availability: async () => 'available', create: async () => ({
          detect: async (text:string) => [{detectedLanguage: text.startsWith('Suomi') ? 'fi' : 'sv', confidence:0.99}]
        })},
        Translator: {availability: async () => 'available', create: async () => ({
          translate: async (text:string) => { await gate; return 'English translation of ' + text + ' with several additional words'; },
          destroy() {}
        })}
      });
    });
    const secret = generateSecretKey(), pubkey = getPublicKey(secret);
    const sign = (kind:number, content:string,tags:string[][]) => finalizeEvent({kind, content, tags, created_at:Math.floor(Date.now()/1000)}, secret);
    const post = sign(1, 'Svenska ord i kroppen #skog', [['subject','Svenska ord i rubriken'],['t','skog']]);
    const reply = sign(1, 'Svenska ord här\n\nSuomi tämä säilyy', [['e',post.id,'','root'],['e',post.id,'','reply'],['p',pubkey]]);
    const profile = sign(0, JSON.stringify({name:'Skog', about:'Svenska ord om mig'}), []);
    const relay = await Relay.connect(process.env.NOSTREDDIT_TEST_RELAY_URL || 'ws://127.0.0.1:43164');
    try { for (const event of [post, reply, profile]) await relay.publish(event); } finally { relay.close(); }
    await page.goto(postUrl(post.id));
    const card = page.locator('[data-route-active="true"] article.detail').first();
    const button = card.getByRole('button',{name:'Translate',exact:true});
    const body = card.locator('.note-text');
    await expect(body).toContainText('Svenska');
    await page.evaluate(() => document.fonts.ready);
    const before = await card.boundingBox();
    await page.evaluate(() => (window as unknown as {finishTranslation():void}).finishTranslation());
    await expect(button).toBeVisible();
    expect(await card.boundingBox()).toEqual(before);
    await expect(body).not.toContainText('English');
    await button.click();
    await expect(body).toContainText('English translation');
    await expect(body.getByRole('link',{name:'#skog'})).toHaveAttribute('href','/t/skog');
    await expect(card.getByRole('heading')).toContainText('English translation');
    await page.screenshot({path:info.outputPath('discussion.png')});
    await card.getByRole('button',{name:'Show original'}).click();
    await expect(body).toHaveText('Svenska ord i kroppen #skog');
    const comment = page.locator('[data-route-active="true"] .comment-card').filter({hasText:'Suomi tämä säilyy'});
    await comment.getByRole('button',{name:'Translate',exact:true}).click();
    await expect(comment.locator('.note-text')).toContainText('English translation of Svenska ord här');
    await expect(comment.locator('.note-text')).not.toContainText('translation of Suomi');
    await expect(comment.getByRole('button',{name:'Show original'})).toHaveCount(1);

    await page.goto(profileUrl(pubkey));
    const bio = page.locator('[data-route-active="true"] .identity [data-translation-item]');
    await expect(bio.getByText('Svenska ord om mig')).toBeVisible();
    await page.evaluate(() => (window as unknown as {finishTranslation():void}).finishTranslation());
    await bio.getByRole('button',{name:'Translate',exact:true}).click();
    await expect(bio).toContainText('English translation of Svenska ord om mig');
    await page.goto('/settings/feeds');
    await expect(page.getByLabel('Translate into')).toHaveValue('en');
    await expect(page.getByRole('button',{name:'Remove Finnish'})).toBeVisible();
    await page.getByLabel('Languages I read').selectOption('sv');
    await page.reload();
    await expect(page.getByRole('button',{name:'Remove Swedish'})).toBeVisible();
  });
}
