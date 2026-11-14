import { markNotificationsSeen } from './network';

type Row = { owner: string; active: boolean; unread: string[] };

// Observe the summary, so opening a long list of posts cannot make the row too
// tall to qualify. The top margin excludes the sticky header on both layouts.
export function seeNotification(node: HTMLElement, row: Row) {
  let visible = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function refresh() {
    clearTimeout(timer);
    if (!visible || !row.active || !row.unread.length || document.visibilityState !== 'visible') return;
    timer = setTimeout(() => {
      if (document.visibilityState === 'visible' && node.getClientRects().length) {
        markNotificationsSeen(row.owner, row.unread);
      }
    }, 650);
  }
  const observer = new IntersectionObserver(entries => {
    visible = entries[entries.length - 1].intersectionRatio >= 0.5;
    refresh();
  }, {threshold: 0.5, rootMargin: '-66px 0px 0px'});
  observer.observe(node);
  return {
    update(next: Row) {
      if (next.owner === row.owner && next.active === row.active && next.unread.join() === row.unread.join()) return;
      row = next;
      refresh();
    },
    destroy() { clearTimeout(timer); observer.disconnect(); },
  };
}
