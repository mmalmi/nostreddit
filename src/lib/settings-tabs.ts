export const settingsTabs = [
  { id: 'appearance', name: 'Appearance', icon: 'art' },
  { id: 'feeds', name: 'Feeds', icon: 'hot' },
  { id: 'network', name: 'Network', icon: 'globe' },
  { id: 'account', name: 'Backup & sync', icon: 'key' },
  { id: 'about', name: 'About', icon: 'book' },
] as const;
export type SettingsTab = (typeof settingsTabs)[number]['id'];
export const isSettingsTab = (value: string): value is SettingsTab => settingsTabs.some(tab => tab.id === value);
