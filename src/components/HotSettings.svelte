<script lang="ts">
  import { hotPreferences, setHotPreferences } from '../lib/hot-preferences';
</script>
<section class="preferences hot-settings" aria-labelledby="hot-settings">
  <h2 id="hot-settings">Hot feed</h2>
  <p>Fresh conversations, people in your network, and a mix of authors. Likes, replies, and zaps count once per person.</p>
  <label><span>Personalize Hot with AI</span><input type="checkbox" checked={$hotPreferences.ai}
    onchange={e=>setHotPreferences({...$hotPreferences,ai:e.currentTarget.checked})}/></label>
  <label class="interests"><span>Your interests</span><textarea rows="2" maxlength="300"
    placeholder="Photography, open-source projects, places to explore…" value={$hotPreferences.interests}
    onchange={e=>setHotPreferences({...$hotPreferences,interests:e.currentTarget.value})}></textarea></label>
  <small>Optional, on this device. Downloads about 33 MB once. Leave interests blank to use joined communities and saved posts, or the topic you’re browsing. Hot works immediately either way.</small>
</section>
<style>
  .hot-settings{margin-bottom:14px}p,small{color:var(--muted);font-size:13px;line-height:1.6}p{margin:0 0 10px}
  .interests{display:block}.interests span{display:block;margin-bottom:8px}textarea{width:100%;resize:vertical;border:1px solid var(--line);border-radius:6px;padding:10px;background:var(--surface);color:inherit}small{display:block;margin-top:10px}
</style>
