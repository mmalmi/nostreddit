import type { NostrEvent as Note } from 'nostr-pubsub';
import { words } from './query';

const references = /(?:nostr:)?(?:npub|nprofile|note|nevent|naddr)1[a-z0-9]+|#\[\d+\]/gi
// Hosts and opaque attachment IDs describe storage, not the subject of a photo.
function readableLink(url: string) {
  const path = url.split(/[?#]/, 1)[0]
  if (/\.(?:jpe?g|png|webp|gif|avif|heic|svg|mp4|m4v|mov|webm)$/i.test(path)) return ""
  return path
    .replace(/^https?:\/\//i, "")
    .replace(/[\w-]{32,}|\b[\da-f]{12,}\b/gi, " ")
    .replace(/[-_/]+/g, " ")
    .trim()
    .slice(0, 140)
}
const links = /https?:\/\/[^\s)]+/gi

function mediaDescriptions(event: Pick<Note, "tags">) {
  return [
    ...new Set(
      event.tags
        .slice(0, 64)
        .flatMap(([name, ...values]) => {
          if (name === "alt" || name === "title") return values.slice(0, 1)
          if (name === "imeta")
            return values.filter((v) => v.startsWith("alt ")).map((v) => v.slice(4))
          return []
        })
        .map((s) => s.slice(0, 240))
    ),
  ]
}

// Long Nostr pointers and tracking parameters can take up the model's entire
// 128-token window. Keep readable link slugs for notes that just share a link.
export function searchPostText(event: Pick<Note, "content" | "tags">) {
  const content = event.content
    .slice(0, 12000)
    .replace(references, " ")
    .replace(
      /<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?\s*\/?>|&(?:#\d+|#x[\da-f]+|[a-z]{2,12});/gi,
      " "
    )
    .replace(links, readableLink)
  const present = new Set(
    Array.from(content.matchAll(/(?:^|\s)#([\p{L}\p{M}\p{N}_-]+)/gu), (m) =>
      m[1].toLowerCase()
    )
  )
  const parts = [content, ...mediaDescriptions(event)]
  for (const [key, value] of event.tags) {
    if (key !== "t" || !value || present.has(value.toLowerCase())) continue
    parts.push("#" + value)
    present.add(value.toLowerCase())
  }
  return parts.join(" ").trim().slice(0, 1800)
}

// Calibrate cosine similarity on short posts. Values near 0.2 were common
// for off-topic notes, while relevant paraphrases often scored around 0.4.
export function calibratedSimilarity(cosine: number) {
  return Math.min(1, Math.max(0, (cosine - 0.16) / 0.48))
}

// A close term in the post can corroborate a weaker whole-post embedding.
// Narrow questions still use their full meaning (e.g. coffee brewing vs beer).
export function semanticMatch(
  cosine: number,
  content: string,
  neighbors?: ReadonlyMap<string, number>,
  broadSubject?: string,
  intentCosine?: number
) {
  if (!neighbors?.size) return calibratedSimilarity(cosine)
  // A post about an aspect of a broad subject may never name the subject.
  // Two independent nearby words are stronger evidence than one stray match.
  const tokens = new Set(words(content))
  const evidence = Array.from(tokens, (t) => neighbors.get(t) ?? 0).sort((a, b) => b - a)
  const [first = 0, second = 0] = evidence
  // On long posts two incidental mentions can swamp the article's subject.
  // Require support across more of the text, capping the effect of synonyms.
  if (broadSubject && tokens.size >= 24) {
    const support =
      evidence.slice(0, 4).reduce((sum, n) => sum + Math.min(0.65, n), 0) / 4
    const meaning = 0.4 * cosine + 0.6 * (intentCosine ?? cosine)
    return calibratedSimilarity(Math.max(0.8 * cosine, 0.8 * support + 0.2 * meaning))
  }
  const nearby = 0.7 * first + 0.3 * second
  let match = Math.max(cosine, 0.8 * nearby + 0.14 * cosine)
  // A category name by itself (e.g. an afterparty at a tech conference)
  // can make the sentence look close even when the rest is off topic.
  if (broadSubject && tokens.has(broadSubject) && nearby < 0.48)
    match *= Math.max(0, 1 - (0.48 - nearby) / 0.48)
  return calibratedSimilarity(match)
}
