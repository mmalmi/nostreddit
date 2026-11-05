import {relayUrls,testRelays} from './relayTypes';
const normalize=(urls:readonly string[])=>[...new Set(urls.map(url=>url.replace(/\/$/, '')))];
export function graphRelayPolicy(urls:readonly string[], defaults:readonly string[]=relayUrls, localTest=testRelays) {
  const relays=normalize(urls), shipped=normalize(defaults);
  const bootstrap=!localTest&&relays.length>0&&relays.length===shipped.length&&shipped.every(url=>relays.includes(url));
  return {bootstrap, relays:localTest?[]:bootstrap?normalize(['wss://graph-relay.iris.to',...relays]):relays};
}
