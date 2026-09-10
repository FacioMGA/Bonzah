// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const calls=vi.hoisted(()=>({list:vi.fn()}));
vi.mock('@/src/modules/policies/api/documentsApiClient',()=>({documentsApiClient:{listPolicyDocuments:calls.list}}));
import { usePolicyDocumentsTab } from './usePolicyDocumentsTab';
describe('document scope hydration',()=>{
  it('ignores a delayed previous-policy response after the selected policy changes',async()=>{
    let resolveOld!:(value:unknown)=>void;
    calls.list.mockImplementation((id:string)=>id==='old'?new Promise(resolve=>{resolveOld=resolve;}):Promise.resolve({success:true,data:[{id:'new-doc',type:'HOME_SCHEDULE_PDF',docPack:'ISSUED_POLICY_PACK',riskTransactionId:'new-risk',status:'GENERATED'}]}));
    const {result,rerender}=renderHook(({id})=>usePolicyDocumentsTab({activeTab:'Documents',selectedPolicyId:id}),{initialProps:{id:'old'}});
    rerender({id:'new'});
    await waitFor(()=>expect(result.current.docs[0]?.id).toBe('new-doc'));
    await act(async()=>resolveOld({success:true,data:[{id:'old-doc',type:'HOME_SCHEDULE_PDF',docPack:'QUOTE_PACK',status:'GENERATED'}]}));
    expect(result.current.docs.map(doc=>doc.id)).toEqual(['new-doc']);
  });
});
