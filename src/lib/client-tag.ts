import { get, writable } from 'svelte/store';
import { readLocal, writeLocal } from './ui';

const key = 'showClientTag';
export const showClientTag = writable(readLocal<boolean>(key, true) !== false);

export function setShowClientTag(enabled: boolean) {
  showClientTag.set(enabled);
  writeLocal(key, enabled);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === 'nostreddit.ui.' + key)
      showClientTag.set(readLocal<boolean>(key, true) !== false);
  });
}

export function postClientTags(): string[][] {
  return get(showClientTag) ? [['client', 'nostreddit']] : [];
}
