import {it,expect} from 'vitest'
import {once} from 'node:events'
import {guestDistributionDenied,GuestDistributionMuxGuard} from '../src/host-distribution-guest-guard.ts'
function frame(text:string,opcode=1,final=true){
  const bytes=Buffer.from(text),mask=Buffer.from([1,2,3,4]),header=bytes.length<126?Buffer.from([(final?128:0)|opcode,128|bytes.length]):Buffer.from([(final?128:0)|opcode,254,bytes.length>>8,bytes.length&255])
  return Buffer.concat([header,mask,Buffer.from(bytes.map((b,i)=>b^mask[i%4]!))])
}
it('denies encoded HTTP and equivalent RPC distribution/native installation paths',()=>{
  for(const path of ['/api/workbench/distribution/v4/export','/api/workbench%2fdistribution/v4/export','/api/%2577orkbench/distribution/v4/export','pluginManager/installBundle','/api/pluginManager/setBundleEnabled','/api/workbench-module-install','/api/credentials/readRecord'])expect(guestDistributionDenied(path),path).toBe(true)
  for(const path of ['/api/session/send','pluginManager/listBundles','/api/workbench-window-close'])expect(guestDistributionDenied(path),path).toBe(false)
})
it('blocks fragmented mux endpoints before any payload is forwarded',async()=>{
  const guard=new GuestDistributionMuxGuard(),out:Buffer[]=[];guard.on('data',b=>out.push(b))
  const text=JSON.stringify({type:'open',streamId:'1',endpoint:'pluginManager/installBundle',payload:{}}),failure=once(guard,'error')
  guard.write(frame(text.slice(0,40),1,false));guard.write(frame(text.slice(40),0,true))
  expect((await failure)[0].message).toContain('host-only');expect(out).toEqual([])
})
it('preserves allowed fragmented mux messages byte for byte',async()=>{
  const guard=new GuestDistributionMuxGuard(),out:Buffer[]=[];guard.on('data',b=>out.push(b))
  const text=JSON.stringify({type:'open',streamId:'1',endpoint:'session/follow',payload:{}}),a=frame(text.slice(0,30),1,false),b=frame(text.slice(30),0,true)
  guard.write(a.subarray(0,5));guard.write(a.subarray(5));guard.end(b)
  await once(guard,'end');expect(Buffer.concat(out)).toEqual(Buffer.concat([a,b]))
})
