import { Transform, type TransformCallback } from 'node:stream'

/** Canonicalize before enforcing the same rule on HTTP and mux endpoints. */
export function guestDistributionDenied(path:string):boolean {
  try {
    for(let n=0;n<4&&path.includes('%');n++)path=decodeURIComponent(path)
  }catch{return true}
  if(path.includes('%')||path.includes(String.fromCharCode(92))||path.includes('//'))return true
  const clean=path.replace(/^[/]?api[/]/u,'').replace(/^[/]/u,'').toLowerCase()
  if(clean.startsWith('dynamiccordisrunner/'))return !/^dynamiccordisrunner[/](?:inventory|syncinspectmanifest|inspectmanifest)$/u.test(clean)
  if(/^(?:pluginmanager|pluginmarket|configeditor|credentials|workbenchdistribution|workbenchhost|workbenchoffline|workbenchmodule|workbenchnative)/u.test(clean)){
    return !/^pluginmanager[/](?:listplugins|listbundles|registries)$/u.test(clean)
  }
  return /^workbench[/](?:distribution|layout-import|offline|module|direct-source|native-offline)/u.test(clean)
    || /^workbench-(?:module|offline|direct-source|native-offline|distribution|layout-import)/u.test(clean)
}

/** Validate complete masked text messages, including fragmented requests, before forwarding. */
export class GuestDistributionMuxGuard extends Transform {
  private buffer=Buffer.alloc(0)
  private frames:Buffer[]=[]
  private payloads:Buffer[]=[]
  private size=0
  _transform(chunk:Buffer,_encoding:BufferEncoding,done:TransformCallback){
    try{
      this.buffer=Buffer.concat([this.buffer,chunk])
      while(this.buffer.length>=2){
        const first=this.buffer[0]!,second=this.buffer[1]!,opcode=first&15,final=!!(first&128)
        if(first&112||!(second&128)||![0,1,8,9,10].includes(opcode))throw new Error('Unsupported guest WebSocket frame')
        let size=second&127,offset=2
        if(size===126){if(this.buffer.length<4)break;size=this.buffer.readUInt16BE(2);offset=4}
        else if(size===127){if(this.buffer.length<10)break;const n=this.buffer.readBigUInt64BE(2);if(n>16n*1024n*1024n)throw new Error('Guest stream too large');size=Number(n);offset=10}
        if(size>16*1024*1024||this.size+size>16*1024*1024)throw new Error('Guest stream too large')
        if(this.buffer.length<offset+4+size)break
        const frame=this.buffer.subarray(0,offset+4+size),mask=frame.subarray(offset,offset+4),body=Buffer.from(frame.subarray(offset+4))
        this.buffer=this.buffer.subarray(frame.length)
        for(let i=0;i<body.length;i++)body[i]=body[i]!^mask[i%4]!
        if(opcode>=8){if(!final||size>125)throw new Error('Invalid control frame');this.push(frame);continue}
        if((opcode===0)!==(this.frames.length>0))throw new Error('Invalid guest fragment')
        this.frames.push(frame);this.payloads.push(body);this.size+=size
        if(!final)continue
        const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(this.payloads)))
        if(!request||typeof request!=='object'||!['open','cancel','end','item'].includes(request.type))throw new Error('Invalid guest request')
        if(request.type==='open'&&(typeof request.endpoint!=='string'||guestDistributionDenied(request.endpoint)))throw new Error('Distribution is host-only')
        for(const part of this.frames)this.push(part)
        this.frames=[];this.payloads=[];this.size=0
      }
      done()
    }catch(error){done(error as Error)}
  }
}
