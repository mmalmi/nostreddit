<script lang="ts">
  import { hotPreferences, setHotPreferences } from '../lib/hot-preferences';
</script>
<section class="preferences hot-settings" aria-labelledby="hot-settings">
  <h2 id="hot-settings">Hot feed</h2>
  <p>Fresh posts and a mix of authors. Each profile counts once across likes, zaps, and replies. Replies have half the weight of a like.</p>
  <label><span>Weight reactions by connection strength</span><input type="checkbox" checked={$hotPreferences.connectionStrength}
    onchange={e=>setHotPreferences({...$hotPreferences,connectionStrength:e.currentTarget.checked})}/></label>
  <small>People you follow count most. Others share influence through their connections. Turning this off uses follow distance instead.</small>
  <label><span>Personalize Hot with AI</span><input type="checkbox" checked={$hotPreferences.ai}
    onchange={e=>setHotPreferences({...$hotPreferences,ai:e.currentTarget.checked})}/></label>
  <label class="interests"><span>Your interests</span><textarea rows="2" maxlength="300"
    placeholder="Photography, open-source projects, places to explore…" value={$hotPreferences.interests}
    onchange={e=>setHotPreferences({...$hotPreferences,interests:e.currentTarget.value})}></textarea></label>
  <small>Optional, on this device. Downloads about 33 MB once. Leave interests blank to use saved posts or the topic you’re browsing. Hot works immediately either way.</small>
</section>
<style>
  .hot-settings{margin-bottom:14px}p,small{color:var(--muted);font-size:13px;line-height:1.6}p{margin:0 0 10px}
  .interests{display:block}.interests span{display:block;margin-bottom:8px}textarea{width:100%;resize:vertical;border:1px solid var(--line);border-radius:6px;padding:10px;background:var(--surface);color:inherit}small{display:block;margin-top:10px}
</style>
