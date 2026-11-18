import {PUBLIC_MOBILE_MIN_USERS} from 'nostr-social-graph/hashtreeSnapshot';

export const discoveryGraphMinimum = (embeddedUsers = 0) => Math.max(PUBLIC_MOBILE_MIN_USERS, Math.ceil(embeddedUsers / 2));

// Only default public discovery uses this policy. Personal graphs can be small.
export function assertDiscoveryGraphCoverage(size, embeddedUsers = 0) {
  const minimum = discoveryGraphMinimum(embeddedUsers);
  if (![size.users, size.follows, size.mutes].every(n => Number.isSafeInteger(n) && n >= 0)
      || !Number.isSafeInteger(minimum) || size.users < minimum) {
    throw new Error('Public discovery graph has insufficient coverage');
  }
  if (size.users > 30_000 || size.follows + size.mutes > 180_000) {
    throw new Error('Public discovery graph exceeds the mobile budget');
  }
}
