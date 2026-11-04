# Nostreddit

[Nostreddit](https://nostreddit.iris.to) is a Reddit-style forum on Nostr. Read a thread without an account, join a topic, or sign in and publish using your own Nostr identity.

## Using the forum

- Open a community such as [/r/photography](https://nostreddit.iris.to/r/photography). Public hashtagged notes appear alongside discussions created here. New topic names work immediately. Matching NIP-72 community definitions can also supply scoped discussions and NIP-22 replies.
- Browse Hot, New, Top, Following, and In network. Search the loaded discussions, open a Nostr profile, or read replies, mentions and likes in Notifications. Saved posts and joined topics are stored in the browser.
- Sign in with a NIP-07 extension, import an nsec, or create a browser-local key. Back up a generated key before signing out. Others can read your posts without using Nostreddit.
- Text and link posts are signed kind 1 events with a topic and subject. Replies preserve thread references. Likes publish kind 7 events, and undo issues a deletion request. Public follows and mutes preserve other entries on your lists. A successful write requires relay acknowledgement.
- Zap a participant who has a Lightning address or LNURL set on their profile. Use a browser wallet or take the invoice to another wallet.

## Data and trust

A dedicated worker runs `nostr-pubsub` for bounded relay subscriptions, verified event ingestion and acknowledged writes. IndexedDB keeps a small snapshot for subsequent visits. After the first successful online visit a service worker caches the public app shell, so previously loaded discussions can be opened offline. A signed starter feed provides an immediate first visit while relays connect. The bundled records came from public relays and retain their original authors, IDs, timestamps and signatures.

A separate worker loads the `nostr-social-graph` snapshot once, uses the guest or signed-in user's graph root, and calculates follow distance and mutes. The 1,941,939-byte graph comes from Iris Social commit `42aff67aa101860437b21c9cddc688dfc4bc04d7`. Its SHA-256 and projection details are in `public/socialGraphSnapshot.provenance.json`. The build and browser verify the graph digest. The feed and graph workers use bounded requests. Hidden tabs suspend relay connections.

Public topic streams are hashtag-based. A shared hashtag does not confer moderator control over other clients. Saved posts, profile keys, joined topics, and drafts belong to the current browser.

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

`pnpm build && pnpm deploy` publishes the verified `dist` bundle to the dedicated Cloudflare Worker configured in `wrangler.jsonc`. The custom domain serves the app entry point for direct topic, profile and thread links. GitHub and Hashtree carry the source history. Deployment credentials stay outside the checkout.
