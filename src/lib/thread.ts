import type { Post } from './posts';

export type CommentOrder = 'top' | 'new' | 'old';
export type CommentRow = {
  post: Post;
  depth: number;
  descendants: number;
  missingParent: boolean;
};

// Root tags identify a whole conversation. For a comment permalink, follow the
// parent edges instead, so its descendants stay visible and its siblings do not.
export function discussionPosts(anchor: string, comments: readonly Post[]): Post[] {
  const children = new Map<string, Post[]>();
  const queue: Post[] = [];
  for (const comment of comments) {
    const branch = children.get(comment.parent);
    if (branch) branch.push(comment);
    else children.set(comment.parent, [comment]);
    if (comment.root === anchor || comment.parent === anchor) queue.push(comment);
  }
  const visited = new Set([anchor]);
  const result: Post[] = [];
  for (let i = 0; i < queue.length; i++) {
    const post = queue[i];
    if (visited.has(post.id)) continue;
    visited.add(post.id);
    result.push(post);
    for (const child of children.get(post.id) ?? []) queue.push(child);
  }
  return result;
}

export function commentRows(anchor: string, posts: readonly Post[], order: CommentOrder, likes: Record<string, string[]>): CommentRow[] {
  const byId = new Map(posts.map(post => [post.id, post]));
  const branches = new Map<string, Post[]>();
  const top: Post[] = [];
  function compare(a: Post, b: Post) {
    const votes = order === 'top' ? (likes[b.id]?.length ?? 0) - (likes[a.id]?.length ?? 0) : 0;
    const time = order === 'new' ? b.created_at - a.created_at : a.created_at - b.created_at;
    return votes || time || a.id.localeCompare(b.id);
  }
  for (const post of byId.values()) {
    if (post.parent === anchor || !byId.has(post.parent) || post.parent === post.id) {
      top.push(post);
    } else {
      const siblings = branches.get(post.parent);
      if (siblings) siblings.push(post);
      else branches.set(post.parent, [post]);
    }
  }
  for (const branch of branches.values()) branch.sort(compare);
  const rows: CommentRow[] = [];
  const seen = new Set<string>();
  function append(start: Post) {
    const stack: Array<{post:Post; depth:number} | number> = [{post:start, depth:0}];
    while (stack.length) {
      const next = stack.pop()!;
      if (typeof next === 'number') {
        rows[next].descendants = rows.length - next - 1;
        continue;
      }
      const {post, depth} = next;
      if (seen.has(post.id)) continue;
      seen.add(post.id);
      // On leaving a node, every row appended beneath it is its descendant.
      stack.push(rows.length);
      rows.push({post, depth, descendants:0, missingParent:depth === 0 && post.parent !== anchor});
      const children = branches.get(post.id) ?? [];
      for (let i = children.length - 1; i >= 0; i--) stack.push({post:children[i], depth:depth+1});
    }
  }
  for (const post of top.sort(compare)) append(post);
  // Inconsistent parent tags must neither loop nor drop a root-tagged discussion.
  if (seen.size < byId.size) {
    for (const post of [...byId.values()].sort(compare)) if (!seen.has(post.id)) append(post);
  }
  return rows;
}

export function visibleCommentRows(rows: readonly CommentRow[], collapsed: ReadonlySet<string>): CommentRow[] {
  const result: CommentRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    result.push(row);
    if (collapsed.has(row.post.id)) i += row.descendants;
  }
  return result;
}
