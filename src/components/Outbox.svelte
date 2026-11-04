<script lang="ts">
  import { pendingWrites, outboxReady, outboxError, retrySync, syncing } from '../lib/network';
  let error='';
  async function retry() {
    try { error=''; await retrySync(); }
    catch(e) {error=e instanceof Error ? e.message : 'Could not retry sync.';}
  }
  $: problems=[...new Set($pendingWrites.map(row=>row.error).filter(Boolean))];
</script>
<section class="preferences outbox" aria-labelledby="outbox-heading" data-pending-count={$pendingWrites.length}>
  <h2 id="outbox-heading">Outbox</h2>
  <p aria-live="polite">{$outboxError || (!$outboxReady ? 'Checking saved changes…' : $pendingWrites.length ? $pendingWrites.length + ' pending ' + ($pendingWrites.length===1 ? 'change' : 'changes') : 'All changes synced.')}</p>
  {#each problems.slice(0,3) as message}<p class="issue">{message}</p>{/each}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if $pendingWrites.length}<button class="outline compact" onclick={retry} disabled={$syncing}>{$syncing ? 'Syncing…' : 'Retry sync'}</button>{/if}
</section>
<style>
  .outbox {margin-top:14px}.outbox p{font-size:13px;color:var(--muted);margin:5px 0}.outbox .issue{color:var(--gold)}.outbox button{margin-top:7px}
</style>
