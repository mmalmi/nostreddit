import { derived } from 'svelte/store';
import { posts, comments } from './network';

// One lookup shared by all cards, containing only graph-visible posts.
export const referencePosts = derived([posts,comments], ([roots,replies]) =>
  new Map([...replies,...roots].map(post=>[post.id,post])));
