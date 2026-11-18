import {test, assertWorkerNetworkBlocked} from './helpers/isolatedBrowser';
// @ts-expect-error Shared executable fixture runs against the built worker.
import {checkGraphCoverage} from '../scripts/check-graph-coverage.mjs';

for(const name of ['valid-small','healthy','healthy-partial','truncated','malformed-large','duplicate-identity','bad-integrity','unavailable','personal-cache','personal-during-fetch'])
test(`default public graph: ${name}`, async ({browser,page,networkBoundary,baseURL},testInfo)=>{
  test.setTimeout(60_000);
  await assertWorkerNetworkBlocked(page,networkBoundary);
  await checkGraphCoverage(browser,baseURL,testInfo.outputPath('graph-coverage.json'),{
    proxy:{server:networkBoundary.url,bypass:'127.0.0.1,localhost,[::1]'},
  },name);
});
