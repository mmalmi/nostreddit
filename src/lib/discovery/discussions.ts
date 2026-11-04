import type { NostrEvent, NostrFilter } from 'nostr-pubsub';
import { discussionKinds, type Post } from '../posts';
import { searchPostText } from './ranking';
import { words, type SearchPlan } from './query';

export interface Expansion { terms: string[]; tags: string[] }
export const noExpansion: Expansion = {terms: [], tags: []};

const documents = new WeakMap<Post, ReturnType<typeof describe>>();
function describe(post: Post) {
  const text = searchPostText(post.event);
  const title = post.title.slice(0, 300);
  const subject = post.event.tags.find(t => t[0] === 'subject')?.[1]?.trim().slice(0,300);
  const meaning = subject && !text.startsWith(subject) ? subject + '. ' + text : text;
  const tags = post.event.tags.filter(t => t[0] === 't' && t[1]).map(t => t[1].normalize('NFKC').toLowerCase());
  return {
    title: words(title).join(' '),
    tags: new Set([...tags, post.topic]),
    words: new Set(words([title, post.body, text, post.topic, post.url, ...tags].join(' '))),
    text: meaning.slice(0, 1800),
  };
}
export function discussionDocument(post: Post) {
  let value = documents.get(post);
  if (!value) { value = describe(post); documents.set(post, value); }
  return value;
}

// A hard tag constraint also applies to model-only results. Whole words keep
// searches such as "art" from matching "party". Title phrases lead the list.
export function keywordScore(plan: SearchPlan, post: Post, author: string) {
  const doc = discussionDocument(post);
  if (!plan.hashtags.every(tag => doc.tags.has(tag.normalize('NFKC').toLowerCase()))) return -1;
  if (!plan.terms.length) {
    if (plan.hashtags.length) return 1;
    return plan.text && doc.text.includes(plan.text) ? 1 : -1;
  }
  const names = new Set(words(author));
  const matched = plan.terms.filter(word => doc.words.has(word) || names.has(word)).length;
  if (!matched) return 0;
  const coverage = matched / plan.terms.length;
  if (coverage < 1) {
    const titleWords = new Set(words(doc.title));
    const anchored = plan.terms.filter(word => doc.tags.has(word) || titleWords.has(word)).length;
    return matched >= 2 && coverage >= 0.6 && anchored >= 2 ? 0.75 : coverage * 0.56;
  }
  const phrase = (' ' + doc.title + ' ').includes(' ' + plan.phrase + ' ');
  if (doc.title === plan.phrase) return 1.4;
  if (phrase) return 1.25;
  return 1 + (doc.tags.has(plan.phrase) ? 0.1 : 0);
}

export function relevance(lexical: number, semantic: number | undefined, minimum = 0.62) {
  if (lexical < 0) return 0;
  if (lexical >= 1) return lexical + 0.12 * (semantic ?? 0);
  if (semantic === undefined) return 0;
  // Two distinct title/tag hits can establish a topic even in a long technical post.
  if (lexical === 0.75) return 0.5 + 0.35 * semantic;
  if (semantic < (lexical ? Math.max(0.46, minimum) : minimum)) return 0;
  return 0.91 * semantic + 0.09 * lexical;
}

export function semanticFloor(plan: SearchPlan | undefined, scores: ReadonlyMap<string, number>) {
  if (!plan || plan.terms.length < 2) return 0.62;
  // A clear best paraphrase can stand on weaker evidence. For a crowded
  // neighborhood, keep a higher bar so the result list stays on topic.
  const best = Math.max(0, ...scores.values());
  return Math.max(0.34, Math.min(0.70, best - 0.12));
}

export function allowModel(plan: SearchPlan) {
  return plan.terms.some(term => term.length >= 2 && /\p{L}/u.test(term)) &&
    !/^(?:(?:nostr:)?(?:npub|nprofile|nevent|note|naddr)1|(?:[a-f\d]{32,})$|https?:\/\/)/i.test(plan.text);
}

export function relayFilters(plan: SearchPlan, expansion: Expansion): NostrFilter[] {
  const base = {kinds: discussionKinds, limit: 40};
  const safe = (value: string) => value.length >= 2 && value.length <= 128 && !/nsec1/i.test(value);
  const queries = [...new Set([plan.relayQuery, ...plan.anchors.slice(0, 2), ...expansion.terms.slice(0, 2)])]
    .filter(safe);
  const filters: NostrFilter[] = queries.map(search => ({...base, search}));
  const tags = [...new Set([...plan.hashtags.slice(0, 4), ...expansion.tags.slice(0, 3)])].filter(safe);
  if (tags.length) filters.push({...base, '#t': tags});
  return filters;
}

// NIP-50 is optional. Relays that ignore search can return a whole timeline.
export function matchesRetrieval(event: NostrEvent, filters: NostrFilter[]) {
  const tags = event.tags.filter(t => t[0] === 't').map(t => t[1]);
  const text = [event.content, searchPostText(event), ...event.tags.filter(t => ['t','subject','title'].includes(t[0])).map(t => t[1])].join(' ').toLowerCase();
  return filters.some(filter => filter.search ? text.includes(filter.search.toLowerCase())
    : filter['#t']?.some(tag => tags.includes(tag)));
}
