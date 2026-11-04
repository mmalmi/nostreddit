<script lang="ts">
  import { defaultImageServer, defaultVideoServer, imageProxySettings, saveImageProxy } from '../lib/image-proxy';
  let error='', saved=false;
  function toggle(field:'enabled'|'fallbackToOriginal',checked:boolean) {
    saveImageProxy({...$imageProxySettings,[field]:checked}); error=''; saved=false;
  }
  function apply(form:HTMLFormElement) {
    const fields = new FormData(form);
    const input = (field:string) => String(fields.get(field) || '');
    try {saveImageProxy({...$imageProxySettings,url:input('url'),vidproxyUrl:input('vidproxyUrl'),
      key:input('key'),salt:input('salt')});error='';saved=true;}
    catch(e) {error=e instanceof Error?e.message:'Could not save proxy settings.';saved=false;}
  }
</script>
<section class="preferences proxy-settings" aria-labelledby="proxy-settings-title">
  <h2 id="proxy-settings-title">Image proxy</h2>
  <label>Load images via proxy<input type="checkbox" checked={$imageProxySettings.enabled} onchange={e=>toggle('enabled',e.currentTarget.checked)} /></label>
  <label>Fallback to original source<input type="checkbox" checked={$imageProxySettings.fallbackToOriginal} onchange={e=>toggle('fallbackToOriginal',e.currentTarget.checked)} /></label>
  <details>
    <summary>Proxy servers and signing</summary>
    <form onsubmit={e=>{e.preventDefault();apply(e.currentTarget);}} oninput={()=>{error='';saved=false;}}>
      <label>Image proxy URL<input type="url" name="url" value={$imageProxySettings.url} placeholder={defaultImageServer} /></label>
      <label>Video thumbnail proxy URL<input type="url" name="vidproxyUrl" value={$imageProxySettings.vidproxyUrl} placeholder={defaultVideoServer} /></label>
      <label>Signing key<input type="password" name="key" value={$imageProxySettings.key} autocomplete="off" spellcheck="false" placeholder="Default key" /></label>
      <label>Salt<input type="password" name="salt" value={$imageProxySettings.salt} autocomplete="off" spellcheck="false" placeholder="Default salt" /></label>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="outline compact" type="submit">Save proxy settings</button>{#if saved}<span role="status">Saved</span>{/if}
    </form>
  </details>
</section>
<style>
  .proxy-settings {margin-top:1rem}
  summary {cursor:pointer;color:var(--green);font-size:.9rem;font-weight:650}
  form label {display:grid;justify-content:stretch;gap:.25rem;border:0;padding:.55rem 0}
  form input {width:100%;height:2.3rem;border:1px solid var(--line);border-radius:6px;padding:.3rem .5rem;
    background:var(--paper);color:var(--ink);font:inherit}
  form button {margin-top:.4rem}
  form span {margin-left:.7rem;color:var(--green);font-size:.85rem}
</style>
