import { writable } from 'svelte/store';
import { readLocal, writeLocal } from './ui';

export const modes = ['system', 'light', 'dark'] as const;
export const themes = ['forest', 'ocean', 'plum', 'ember'] as const;
type Appearance = { mode: typeof modes[number]; theme: typeof themes[number] };

function preferences(value: Partial<Appearance> | DOMStringMap | null): Appearance {
  return {
    mode: modes.find(mode => mode === value?.mode) ?? 'system',
    theme: themes.find(theme => theme === value?.theme) ?? 'forest',
  };
}

export const appearance = writable(preferences(document.documentElement.dataset));

export function setAppearance(value: Appearance) {
  appearance.set(value);
  writeLocal('appearance', value);
}

export function watchAppearance() {
  const root = document.documentElement;
  const tint = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const updateTint = () => { tint.content = getComputedStyle(root).backgroundColor; };
  const unsubscribe = appearance.subscribe(({ mode, theme }) => {
    root.dataset.mode = mode;
    root.dataset.theme = theme;
    updateTint();
  });
  const syncStorage = (event: StorageEvent) => {
    if (event.key === 'nostreddit.ui.appearance' || event.key === null)
      appearance.set(preferences(readLocal('appearance', null)));
  };
  system.addEventListener('change', updateTint);
  window.addEventListener('storage', syncStorage);
  return () => {
    unsubscribe();
    system.removeEventListener('change', updateTint);
    window.removeEventListener('storage', syncStorage);
  };
}
