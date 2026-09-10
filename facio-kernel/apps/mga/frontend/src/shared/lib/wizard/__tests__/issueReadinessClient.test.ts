// @vitest-environment happy-dom
import {afterEach,expect,it,vi} from 'vitest';
import {clearSelectedTenant,installSelectedTenant} from '../../tenant/runtimeProfile';
import {presentationTenant} from '../../tenant/testFixture';
import {fetchIssueReadinessRaw} from '../issueReadinessClient';
afterEach(()=>{vi.unstubAllGlobals();clearSelectedTenant();localStorage.clear();});
it('forwards authorized operating context and rejects stale-workspace readiness reads before fetching',async()=>{
 installSelectedTenant(presentationTenant());localStorage.setItem('active_operating_tenant_id','tenant-alpha');localStorage.setItem('auth_token','selected-training-token');
 const fetch=vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({success:true,data:{ready:false}})});vi.stubGlobal('fetch',fetch);
 await fetchIssueReadinessRaw('home','opaque-token');expect(fetch).toHaveBeenCalledWith('/api/public/home/session/opaque-token/issue-readiness',{headers:{Authorization:'Bearer selected-training-token','X-Tenant-Slug':'tenant-alpha','x-tenant-id':'account-tenant-alpha'}});
 localStorage.setItem('active_operating_tenant_id','tenant-beta');await expect(fetchIssueReadinessRaw('home','opaque-token')).rejects.toThrow('active workspace changed');expect(fetch).toHaveBeenCalledTimes(1);
});
