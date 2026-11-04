import { writable } from 'svelte/store';
import type { GraphBadge } from './graph-model';
import { readLocal, writeLocal } from './ui';

export type VisibilitySettings = { maxDistance: 1 | 2 | 3 | 4 | 5 | null; hideOvermuted: boolean };
const defaults: VisibilitySettings = { maxDistance: 5, hideOvermuted: true };

function normalized(value: Partial<VisibilitySettings> | null): VisibilitySettings {
  const distance = value?.maxDistance;
  return {
    maxDistance: distance === null || distance === 1 || distance === 2 || distance === 3 || distance === 4 || distance === 5
      ? distance : defaults.maxDistance,
    hideOvermuted: typeof value?.hideOvermuted === 'boolean' ? value.hideOvermuted : defaults.hideOvermuted,
  };
}

const settings = writable(normalized(readLocal<VisibilitySettings | null>('graphVisibility', null)));
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === 'nostreddit.ui.graphVisibility' || event.key === null) {
      settings.set(normalized(readLocal<VisibilitySettings | null>('graphVisibility', null)));
    }
  });
}
export const visibilitySettings = {
  subscribe: settings.subscribe,
  set(value: VisibilitySettings) {
    const next = normalized(value);
    settings.set(next);
    writeLocal('graphVisibility', next);
  },
};

export type ViewerLists = { viewer: string; follows: ReadonlySet<string>; mutes: ReadonlySet<string> };

export function authorPolicy(lists: ViewerLists, options: VisibilitySettings, badges: Readonly<Record<string, GraphBadge>>, ready: boolean) {
  return (key: string): boolean => {
    if (!key) return false;
    if (key === lists.viewer) return true;
    const badge = badges[key];
    if (lists.mutes.has(key) || badge?.muted) return false;
    if (lists.follows.has(key)) return true;
    if (!ready || !badge) return options.maxDistance === null && !options.hideOvermuted;
    if (options.hideOvermuted && badge.overmuted) return false;
    return options.maxDistance === null || (badge.distance !== null && badge.distance <= options.maxDistance);
  };
}
