import {expect,test} from '@playwright/test';
import {allowFixtureAuthors} from './helpers/graphPreferences';

test.beforeEach(async({context})=>{await allowFixtureAuthors(context);});

for(const width of [1440,390,320]) {
  test(`feed composer and inline replies preserve drafts at ${width}px`,async({page},info)=>{
    await page.setViewportSize({width,height:width===320?640:900});
    await page.goto('/t/photography');
    await expect(page.getByRole('heading',{name:'t/photography',exact:true})).toBeVisible();
    await expect(page.getByRole('link',{name:'Notes from the coast',exact:true}).first()).toBeVisible();
    await page.screenshot({path:info.outputPath('feed-prompt.png')});
    await page.getByRole('main').getByRole('button',{name:'Create a post',exact:true}).first().click();
    await page.getByRole('button',{name:'Create profile',exact:true}).click();
    const editor=page.getByRole('dialog',{name:'Create post',exact:true});
    await expect(editor.getByLabel('Topic',{exact:true})).toHaveValue('photography');
    await expect(editor.getByRole('tab',{name:'Text',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(editor).not.toContainText('No #hashtag needed');
    const title=`Field notes at ${width}px`;
    await editor.getByLabel('Post',{exact:true}).fill(title+'\n\nThe tide is turning.');
    await editor.getByRole('tab',{name:'Link',exact:true}).click();
    await editor.getByRole('textbox',{name:'Link',exact:true}).fill('https://example.com/unused-link');
    await editor.getByRole('tab',{name:'Text',exact:true}).click();
    await editor.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.getByRole('main').getByRole('button',{name:'Create a post',exact:true}).first().click();
    await expect(editor.getByLabel('Post',{exact:true})).toHaveValue(title+'\n\nThe tide is turning.');
    await editor.getByRole('tab',{name:'Text',exact:true}).focus();
    await page.keyboard.press('ArrowRight');
    await expect(editor.getByRole('tab',{name:'Link',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(editor.getByRole('textbox',{name:'Link',exact:true})).toHaveValue('https://example.com/unused-link');
    await page.keyboard.press('ArrowLeft');
    await page.screenshot({path:info.outputPath('post-editor.png')});
    await editor.getByRole('button',{name:'Publish post',exact:true}).click();
    await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
    await expect(page.locator('[data-route-active=\"true\"] main article').first()).not.toContainText('unused-link');
    const reply=page.getByLabel('Your reply',{exact:true});
    await expect(reply).toHaveAttribute('rows','1');
    await reply.fill('Looking out from the pier.');
    await expect(reply).toHaveAttribute('rows','3');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(reply).toHaveAttribute('rows','1');
    await reply.click();
    await expect(reply).toHaveValue('Looking out from the pier.');
    await page.getByRole('button',{name:'Post reply',exact:true}).click();
    const row=page.locator('[data-route-active=\"true\"] li[data-comment-id]').filter({hasText:'Looking out from the pier.'});
    await row.getByRole('button',{name:'Reply to comment',exact:true}).click();
    const nested=row.getByRole('textbox');
    await expect(nested).toBeFocused();
    await nested.fill('I can see the boats from here.');
    await page.screenshot({path:info.outputPath('inline-reply.png')});
    await row.getByRole('button',{name:'Post reply',exact:true}).click();
    await expect(page.locator('[data-route-active=\"true\"] li[data-depth="1"]').filter({hasText:'I can see the boats from here.'})).toBeVisible();
    await page.screenshot({path:info.outputPath('published-replies.png')});
    const overflow=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,class:el.className,right:el.getBoundingClientRect().right})).slice(0,12));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),JSON.stringify(overflow)).toBe(true);
  });
}

test('the feed link shortcut explains missing fields and publishes a link post',async({page},info)=>{
  await page.goto('/');
  await page.getByRole('main').getByRole('button',{name:'Create a link post',exact:true}).click();
  await page.getByRole('button',{name:'Create profile',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'Create post',exact:true});
  await expect(editor.getByRole('tab',{name:'Link',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(editor.getByLabel('Topic',{exact:true})).toHaveValue('');
  const publish=editor.getByRole('button',{name:'Publish post',exact:true});
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(editor.getByRole('alert')).toHaveText('Add a link to share.');
  await expect(editor.getByRole('textbox',{name:'Link',exact:true})).toBeFocused();
  await editor.getByLabel('Post',{exact:true}).fill('A useful field guide');
  await editor.getByLabel('Topic',{exact:true}).fill('t/field-guides');
  await editor.getByRole('textbox',{name:'Link',exact:true}).fill('not a link');
  await publish.click();
  await expect(editor.getByRole('alert')).toHaveText('Enter a web or Hashtree link.');
  await editor.getByRole('textbox',{name:'Link',exact:true}).fill('https://example.org/field-guide');
  await page.screenshot({path:info.outputPath('link-editor.png')});
  await publish.click();
  await expect(page.getByRole('heading',{name:'A useful field guide',exact:true})).toBeVisible();
  await expect(page.locator('[data-route-active=\"true\"] main article').first().getByRole('link',{name:'t/field-guides',exact:true})).toBeVisible();
  await expect(page.locator('[data-route-active=\"true\"] main article a[href="https://example.org/field-guide"]').first()).toBeVisible();
});

test('attachments upload to Blossom and publish as a plain link',async({page},info)=>{
  const blobs=new Map<string,Buffer>();
  await page.route(/^https:\/\/upload\.iris\.to\//,async route=>{
    const request=route.request();
    if(request.method()==='PUT') {
      const bytes=request.postDataBuffer()!;
      const {createHash}=await import('node:crypto');
      const hash=createHash('sha256').update(bytes).digest('hex');
      expect(request.headers()['x-sha-256']).toBe(hash);
      expect(request.headers().authorization).toMatch(/^Nostr /);
      blobs.set(hash,bytes);
      await route.fulfill({json:{sha256:hash,size:bytes.length,url:`https://upload.iris.to/${hash}.txt`}});
    } else await route.fulfill({status:404});
  });
  await page.goto('/t/photography');
  await page.getByRole('main').getByRole('button',{name:'Create a post',exact:true}).first().click();
  await page.getByRole('button',{name:'Create profile',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'Create post',exact:true});
  await editor.getByLabel('Post',{exact:true}).fill('Attached field notes');
  await editor.getByLabel('Attach files',{exact:true}).setInputFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('Notes from the shore')});
  await expect(editor.getByLabel('Post',{exact:true})).toHaveValue(/^Attached field notes\n\nhttps:\/\/upload\.iris\.to\/[0-9a-f]{64}\.txt$/);
  expect(blobs.size).toBe(1);
  const [hash]=[...blobs.keys()];
  await page.screenshot({path:info.outputPath('attachment-ready.png')});
  await editor.getByRole('button',{name:'Publish post',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Attached field notes',exact:true})).toBeVisible();
  await expect(page.locator(`[data-route-active="true"] main article a[href="https://upload.iris.to/${hash}.txt"]`).first()).toBeVisible();
});

for (const width of [1440,390,320]) {
  test(`post preview preserves edits and publishes only on request at ${width}px`,async({page},info)=>{
    await page.setViewportSize({width,height:900});
    await page.goto('/t/photography');
    await page.getByRole('main').getByRole('button',{name:'Create a post',exact:true}).first().click();
    await page.getByRole('button',{name:'Create profile',exact:true}).click();
    const editor=page.getByRole('dialog',{name:'Create post',exact:true});
    await expect(editor.getByRole('button',{name:'Preview',exact:true})).toBeDisabled();
    await editor.getByLabel('Post',{exact:true}).fill('Preview from the coast\n\nFirst line\nSecond line #photography');
    await editor.getByRole('tab',{name:'Link',exact:true}).click();
    await editor.getByRole('textbox',{name:'Link',exact:true}).fill('https://example.org/coast');
    await editor.getByRole('button',{name:'Preview',exact:true}).click();
    const preview=editor.getByRole('region',{name:'Post preview',exact:true});
    await expect(preview.getByRole('heading',{name:'Preview from the coast',exact:true})).toBeVisible();
    await expect(preview).toContainText('Second line');
    await expect(preview.locator('a[href="https://example.org/coast"]').first()).toBeVisible();
    await expect(preview.getByRole('button',{name:'Like',exact:true})).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('heading',{name:'Preview from the coast',exact:true})).toHaveCount(0);
    await page.screenshot({path:info.outputPath(`post-preview-${width}.png`)});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await editor.getByRole('button',{name:'Edit post',exact:true}).click();
    await expect(editor.getByLabel('Post',{exact:true})).toHaveValue('Preview from the coast\n\nFirst line\nSecond line #photography');
    await editor.getByLabel('Post',{exact:true}).fill('Updated coast preview '+width+'\n\nFirst line\nSecond line #photography');
    await editor.getByRole('button',{name:'Preview',exact:true}).click();
    await expect(preview.getByRole('heading',{name:'Updated coast preview '+width,exact:true})).toBeVisible();
    await editor.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.getByRole('main').getByRole('button',{name:'Create a post',exact:true}).first().click();
    await expect(editor.getByLabel('Post',{exact:true})).toHaveValue(/^Updated coast preview /);
    await editor.getByRole('button',{name:'Preview',exact:true}).click();
    await editor.getByRole('button',{name:'Publish post',exact:true}).click();
    await expect(page.getByRole('main').getByRole('heading',{name:'Updated coast preview '+width,exact:true})).toBeVisible();
  });
}
