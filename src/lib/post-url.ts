import { decode, noteEncode } from 'nostr-tools/nip19';
import { topicSlug } from './hashtags';

const eventIdPattern = /^[a-f0-9]{64}$/i;
export function isEventId(id: string): boolean { return eventIdPattern.test(id); }

// Only relay filters and event tags use the raw id; links share the portable NIP-19 note identifier.
export function postUrl(id: string, fromTopic?: string): string {
  if (!isEventId(id)) throw new TypeError('Invalid Nostr event ID.');
  const topic = fromTopic ? topicSlug(fromTopic) : '';
  return '/post/' + noteEncode(id.toLowerCase()) + (topic ? '?r=' + encodeURIComponent(topic) : '');
}

export function postIdFromPath(value: string): string | null {
  if (isEventId(value)) return value.toLowerCase();
  if (!/^(?:note|nevent)1/i.test(value)) return null;
  try {
    const pointer = decode(value);
    const id = pointer.type === 'note' ? pointer.data : pointer.type === 'nevent' ? pointer.data.id : '';
    return isEventId(id) ? id.toLowerCase() : null;
  } catch { return null; }
}
