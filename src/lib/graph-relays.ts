import {previousRelayUrls,relayUrls,testRelays} from './relayTypes';
const normalize=(urls:readonly string[])=>[...new Set(urls.map(url=>url.replace(/\/$/, '')))];
const sameSet=(a:readonly string[], b:readonly string[])=>a.length>0&&a.length===b.length&&b.every(url=>a.includes(url));
export function graphRelayPolicy(urls:readonly string[], defaults:readonly string[]=relayUrls, localTest=testRelays) {
  const relays=normalize(urls), shipped=normalize(defaults);
  const bootstrap=!localTest&&(sameSet(relays,shipped)||(defaults===relayUrls&&sameSet(relays,previousRelayUrls)));
  const prioritized=bootstrap&&relays.includes('wss://relay.ditto.pub')?
    ['wss://relay.ditto.pub',...relays]:relays;
  return {bootstrap, relays:localTest?[]:bootstrap?normalize(['wss://graph-relay.iris.to',...prioritized]):relays};
}
