<script lang="ts">
  import { topicSlug } from '../lib/hashtags';
  import { readLocal, writeLocal } from '../lib/ui';
  import Icon from './Icon.svelte';
  export let oncreate:(slug:string)=>void;
  let name=readLocal<string>('newCommunity',''),error='';
  $: slug=topicSlug(name.trim().replace(/^r\//i,''));
  function create(){
    if(!slug){error='Use 1–48 letters, numbers, underscores, or hyphens.';return;}
    writeLocal('newCommunity','');oncreate(slug);
  }
</script>
<div class="dialog-content">
  <h2>Create a community</h2>
  <form onsubmit={e=>{e.preventDefault();create();}}>
    <label>Community name<input required maxlength="50" placeholder="e.g. gardening" value={name}
      oninput={e=>{name=e.currentTarget.value;writeLocal('newCommunity',name);error='';}}/></label>
    {#if slug}<p class="preview">r/{slug}</p>{/if}
    <p>Start with a post. Anyone can use the name and join the conversation.</p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="composer-foot"><button class="primary" type="submit"><Icon name="edit" size={15}/>Write the first post</button></div>
  </form>
</div>
<style>p{font-size:13px;color:var(--muted);margin:12px 0}.preview{color:var(--accent);font-weight:650}.composer-foot{justify-content:flex-end}</style>
