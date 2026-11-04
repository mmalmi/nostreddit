# Nostreddit

[Nostreddit](https://nostreddit.iris.to) is a Reddit-style forum on Nostr. Read a thread without signing in, join a topic, or sign in and publish using your own Nostr identity.

Source: [GitHub](https://github.com/mmalmi/nostreddit) · [git.iris.to](https://git.iris.to/#/npub1xdhnr9mrv47kkrn95k6cwecearydeh8e895990n3acntwvmgk2dsdeeycm/nostreddit)

## Using the forum

- Open a community such as [/r/photography](https://nostreddit.iris.to/r/photography). Public hashtagged notes appear alongside discussions created here. New topic names work immediately. Matching NIP-72 community definitions can also supply scoped discussions and NIP-22 replies.
- Choose **Create community**, enter a name, and write its first post. This creates an open hashtag topic: names are shared, with no owners, admins, rules or metadata event. Topic headers use the name and a generated hashtag icon; there are no hardcoded descriptions or branding.
- Browse Hot, New, Top, Following, and In network. Search loaded discussions by title, author, topic, or meaning. Try “find posts about live rock performances.” Best match puts the most relevant discussions first. Paste an npub, nprofile, note, or nevent to open it directly. Open a Nostr profile, or read replies, mentions and likes in Notifications. Saved posts and joined topics are stored in the browser.
- Create a profile with the suggested name or choose your own. Returning users can sign in with a NIP-07 extension or an nsec. To back up a local profile, open Settings → Profile backup and reveal its secret key. Others can read your posts without using Nostreddit.
- Text and link posts are signed kind 1 events with a topic and subject. Replies preserve thread references. Comments nest beneath their parent, with inline replies, collapsible branches, and Top, New, and Old sibling sorting. Post and reply permalinks use NIP-19 `note1…` identifiers. Existing hexadecimal links open the same discussion, including its topic context. A comment permalink shows its own branch. Likes publish kind 7 events, and undo issues a deletion request. Public follows and mutes preserve other entries on your lists. Posts, replies, likes, follows, mutes, and profile edits save on this device immediately. Settings → Outbox shows pending changes and lets you retry delivery. On reconnect, list and profile edits merge into the latest signed record. An imported profile can edit offline without overwriting fields it hasn’t fetched yet.
- Zap a participant who has a Lightning address or LNURL set on their profile. Use a browser wallet or take the invoice to another wallet.

Settings → Image proxy controls how remote images and video thumbnails load. The Iris proxy is enabled by default. You can disable fallback to the original image host or configure your own proxy servers and signing settings.

Hot ranks recent likes and zaps from distinct profiles, with more weight for direct follows. Indirect reactions carry less weight when few direct connections know the sender. Replies do not count as positive votes. Old activity fades, self-reactions do not count, and zap amounts do not buy position. Different keys do not prove different people. It mixes authors and leaves one in five places for a fresh unendorsed post when one is available. Joined communities, saved topics and recently opened posts help personalize the order. New and Top remain available. Once you scroll into the feed, incoming activity preserves the reading order; **Show updated posts** applies the new ranking.

Settings → Hot feed offers optional local AI personalization. Enter interests, or leave them blank to use joined communities, saved posts or the current topic. The existing pinned MiniLM model boosts matching meanings without removing discussions or overriding community membership and graph settings. Social ranking appears immediately and remains the default. AI runs in one worker on at most 48 candidates at a time, with a 72-document budget per feed visit, and releases the runtime after idle. Hidden tabs stop inference. Three bounded sets of meaning scores stay on the device for fast offline reuse. Interests and post text are never sent to an AI provider.

Appearance follows your device by default. In Settings → Appearance, you can switch to Light or Dark and choose a Forest, Ocean, Plum, or Ember palette. Both choices are saved in this browser.

[Settings](https://nostreddit.iris.to/settings) lets guests and signed-in readers choose their feed order, image previews, and social graph filters. The default maximum is five follow steps. Choose Unlimited to include distant profiles, or turn off community mute filtering. Your own mutes still apply. The same rules apply to discussions, comments, profiles, reactions, notifications, and zap senders.

Profile URLs use npub and old hexadecimal links still open. The Followers and Following tabs show known public relationships under the selected graph filters. Iris Kit checkmarks show direct follows in blue, two-step connections in gray, and profiles followed by more than ten direct connections in gold. The expandable profile explanation distinguishes your personal follow graph from the public discovery graph used for guests and profiles without follows. These badges describe connections, not verified identity or endorsement. Profile pages use Iris Kit’s Svelte avatar, display-name, social-distance badge, and copy controls. The vendored UI package is from Iris Kit commit `3d26f8ca79ac40493e4e6f94afa629a1d79defcb`, the same archive used by Iris Social. The build verifies SHA-256 `888f94c1422f07db33bc4b209a3b2bf5f13b12492c53d717660076de755c935b`.

## Data and trust

A dedicated worker runs `nostr-pubsub` for bounded relay subscriptions, verified event ingestion and acknowledged writes. IndexedDB keeps a small snapshot for subsequent visits. After the first successful online visit a service worker caches the public app shell, so previously loaded discussions can be opened offline. A signed starter feed provides an immediate first visit while relays connect. The bundled records came from public relays and retain their original authors, IDs, timestamps and signatures.

Nostreddit can be installed as a standalone app using the browser’s install or Add to Home Screen command. Vite PWA builds the manifest and the service worker. An update activates after tabs using the previous worker close. Queued posts and profile edits stay in IndexedDB across updates. Previously loaded discussions are available within a bounded local history. New relay data, external players, and Lightning invoices require a connection.

A separate worker loads the `nostr-social-graph` snapshot once. Guests and profiles without follows use the public graph for discovery. A profile with follows uses its own graph. Settings controls the maximum follow distance (default five) and whether to hide authors with more mutes than follows at the nearest distance with an opinion (default on). Personal mutes always apply. These rules cover public posts, replies, likes, named zap senders, notifications, profile metadata, communities, search results and local bookmarks. Signed contact lists, deletions and wallet confirmations still run independently of display filters. The 1,941,939-byte graph comes from Iris Social commit `42aff67aa101860437b21c9cddc688dfc4bc04d7`. Its SHA-256 and projection details are in `public/socialGraphSnapshot.provenance.json`. The build and browser verify the graph digest. Full-text search contacts relay.ditto.pub and search.nos.today only when the reader selects Search relays. The feed and graph workers use bounded requests. Hidden tabs suspend relay connections.

Discussion search shows keyword matches immediately. With **Match related meanings** enabled, the first submitted text search loads about 33 MiB of optional assets from this site. The quantized MiniLM model, keyword index and hashtag scorer from Iris Client run in a browser worker. They rank a bounded window of up to 160 visible discussions. The offline shell caches these assets on demand. Turning the option off keeps keyword search available. **Search relays** sends the subject and a bounded set of related words or hashtags to public relays. The model runs locally in either case. Model attribution and input hashes are included in the distribution.

Open a photo to expand it. Small public photos opened from hosts that permit caching are kept for offline revisits. Direct audio and video use native playback, and YouTube and Vimeo players load on request. Hashtree attachments verify downloaded blocks before opening.

Click a hashtag in a headline, post, or reply to open its topic feed. Publishing signs each distinct hashtag as a lowercase Nostr `t` tag, with the chosen community first. A tagged reply links to its own branch. Public hashtag notes can appear in multiple matching topics. In a topic feed, the card links to the topic being browsed. Explicit community addresses take precedence over hashtags. A shared hashtag does not confer moderator control over other clients. Saved posts, profile keys, joined topics, and drafts belong to the current browser.

Hashtree attachments accept Iris-style `htree://nhash…/filename` links, equivalent bare nhash paths and Iris Drive fragment links. Opening an attachment fetches hash-addressed blocks from the Iris Blossom readers, checks their SHA-256 hashes, and decrypts them on the device. Verified wire blocks are retained for offline revisits within an 80 MiB / 512-block cache. Inline reads are limited to 64 MiB of plaintext; larger items can be opened in Iris Drive.

Hot reads engagement for up to 160 eligible posts independently of which cards are on screen. On Home it also reads recent likes from up to 64 follows (or nearby public-graph authors for guests), fetching at most 48 referenced discussions. These are bounded history requests, with no idle polling. All authors and activity still pass through the current social-graph policy. Counts represent the events available from connected relays, not a complete network-wide total.

The reader uses the vendored `@hashtree/core` 0.4.0 archive from [Hashtree TS runtime v0.5.27](https://github.com/mmalmi/hashtree/releases/tag/hashtree-ts-runtime-v0.5.27), the same SHA-512 pin as Iris Social. The build verifies the archive; the frozen lockfile pins its MessagePack, hashing and bech32 dependencies.

## Reproducing and testing

Use Node.js 26.12.1 and pnpm 10.28.2. The project was built on macOS arm64. It produces static HTML, CSS, JavaScript workers and data files. There is no server database. Dependencies and release tarballs are pinned in `pnpm-lock.yaml`.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm check
pnpm test
pnpm build
pnpm test:browser
```

The browser suite requires Playwright's Chromium installation matching the locked Playwright version. It uses a dedicated production build and a loopback relay, isolated from public Nostr. For an idle CPU sample including workers, run `node scripts/measure-idle.mjs <running-site-url>`. To develop against your own relay, set `VITE_NOSTR_RELAYS` before building. This also disables the public starter feed.

## Deploying

`pnpm build && pnpm run deploy` publishes the verified `dist` bundle to the dedicated Cloudflare Worker configured in `wrangler.jsonc`. The custom domain serves the app entry point for direct topic, profile and thread links. GitHub and Hashtree carry the source history. Deployment credentials stay outside the checkout.
