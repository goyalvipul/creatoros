import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sql, fileInstances, logicalAssets, assetVersions, assetFileLinks, eq } from '@creatoros/db';
import { canonicalPath, pathSeparator, isInsideRoot, type PathOs } from '@creatoros/domain';
import { audit, badRequest, conflict, notFound, getDeviceSigningKey, signAgentFetch, type Ctx } from '@creatoros/services';

const exec = promisify(execFile);
const rows = <T>(r: unknown) => (r as {rows:T[]}).rows;
export const MAX_MEDIA_BYTES = 2 * 1024 * 1024;
const mimeMap = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', wav:'audio/wav', mp3:'audio/mpeg', flac:'audio/flac' } as const;

export function decodeMedia(input: {fileName:string;mime:string;base64:string}, kind:'IMAGE'|'AUDIO') {
  const name=input.fileName;
  if(!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,119}$/.test(name)||name.includes('..')||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name))throw badRequest('Use a simple filename with a supported extension.');
  const ext=name.split('.').pop()!.toLowerCase() as keyof typeof mimeMap;
  const mime=mimeMap[ext];
  if(!mime||mime!==input.mime||!mime.startsWith(kind==='IMAGE'?'image/':'audio/'))throw badRequest('File extension and MIME must match the upload kind.');
  if(input.base64.length>Math.ceil(MAX_MEDIA_BYTES/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))throw badRequest('Invalid or oversized base64.');
  const bytes=Buffer.from(input.base64,'base64');
  if(!bytes.length||bytes.length>MAX_MEDIA_BYTES||bytes.toString('base64')!==input.base64)throw badRequest('Use canonical base64, at most 2 MiB decoded.');
  const signature=ext==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
    ext==='jpg'||ext==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:
    ext==='webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':
    ext==='wav'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE':
    ext==='flac'?bytes.toString('ascii',0,4)==='fLaC':
    bytes.toString('ascii',0,3)==='ID3'||(bytes[0]===255&&((bytes[1]??0)&224)===224);
  if(!signature)throw badRequest('File signature does not match the declared type.');
  return {bytes,mime,ext};
}

async function probeMedia(bytes:Buffer,ext:string,kind:'IMAGE'|'AUDIO') {
  const dir=await mkdtemp(join(tmpdir(),'kk-media-'));
  try {
    const file=join(dir,'input.'+ext);
    await writeFile(file,bytes,{mode:0o600});
    const format=ext==='png'?'png_pipe':ext==='jpg'||ext==='jpeg'?'jpeg_pipe':ext==='webp'?'webp_pipe':ext;
    const {stdout}=await exec('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-f',format,'-show_streams','-show_format','-of','json',file],{timeout:10000,maxBuffer:262144});
    const info=JSON.parse(stdout) as {streams?:{codec_type?:string; width?:number;height?:number;duration?:string;sample_rate?:string;channels?:number}[];format?:{duration?:string}};
    const streams=info.streams??[];
    if(kind==='IMAGE'){
      const s=streams[0];
      if(streams.length!==1||s?.codec_type!=='video'||!s.width||!s.height||s.width>4096||s.height>4096||s.width*s.height>16777216)throw badRequest('Image must be a valid still, at most 4096 pixels per side.');
      return {width:s.width,height:s.height};
    }
    const s=streams[0];
    const seconds=Number(info.format?.duration??s?.duration);
    if(streams.length!==1||s?.codec_type!=='audio'||!Number.isFinite(seconds)||seconds<=0||seconds>600||Number(s.sample_rate)>96000||(s.channels??0)>2)throw badRequest('Audio must be a single mono/stereo track up to 10 minutes and 96 kHz.');
    return {durationMs:Math.round(seconds*1000),channels:s.channels,sampleRate:Number(s.sample_rate)};
  }catch{throw badRequest('Media could not be validated or exceeds supported dimensions/duration.');}
  finally{await rm(dir,{recursive:true,force:true});}
}

type UploadInput={rootId:string;brandId:string;projectId?:string|null;fileName:string;mime:string;base64:string};
export async function uploadGatewayMedia(ctx:Ctx,input:UploadInput,requestId:string,kind:'IMAGE'|'AUDIO') {
  const {bytes,mime,ext}=decodeMedia(input,kind);
  const tech=await probeMedia(bytes,ext,kind);
  if(!rows(await ctx.db.execute(sql`select id from brands where id=${input.brandId} and org_id=${ctx.orgId} and active and deleted_at is null`)).length)throw notFound('Creator');
  if(input.projectId&&!rows(await ctx.db.execute(sql`select id from creative_projects where id=${input.projectId} and org_id=${ctx.orgId} and brand_id=${input.brandId} and deleted_at is null`)).length)throw notFound('Creator project');
  const [root]=rows<{id:string;device_id:string;display_path:string;path_os:string;listen_urls:string[]}>(await ctx.db.execute(sql`select r.id,r.device_id,r.display_path,r.path_os,d.listen_urls from storage_roots r join devices d on d.id=r.device_id and d.org_id=r.org_id where r.id=${input.rootId} and r.org_id=${ctx.orgId} and r.retired_at is null and r.state='ACTIVE' and d.state='ONLINE'`));
  if(!root)throw badRequest('Select an active indexed folder on an online scanner.');
  const os:PathOs=root.path_os==='windows'?'windows':'posix';
  const name='kk_'+requestId+'_'+input.fileName;
  const displayPath=root.display_path.replace(/[\\/]+$/,'')+pathSeparator(os)+name;
  const canonical=canonicalPath(displayPath,os);
  if(!isInsideRoot(canonicalPath(root.display_path,os),canonical,os))throw badRequest('Destination outside indexed root.');
  if(rows(await ctx.db.execute(sql`select id from file_instances where root_id=${root.id} and canonical_path=${canonical} and archived_at is null`)).length)throw conflict('Destination already exists; inspect the original request.');
  const key=await getDeviceSigningKey(ctx.env,root.device_id,ctx.db);
  if(!key||!root.listen_urls?.length)throw badRequest('Scanner is not paired or reachable.');
  const exp=Math.floor(Date.now()/1000)+300;
  const sig=signAgentFetch(key,root.id,displayPath,exp);
  const loopback=ctx.env.processEnv.AGENT_LOOPBACK_HOST;
  const base=loopback?root.listen_urls[0]!.replace(/\/\/(127\.0\.0\.1|localhost)/,'//'+loopback):root.listen_urls[0]!;
  const url=new URL('/v1/upload',base);
  url.search=new URLSearchParams({root:root.id,path:displayPath,exp:String(exp),sig}).toString();
  // Do not retry an uncertain upload. The scanner refuses overwrites.
  const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'content-type':'application/octet-stream','content-length':String(bytes.length)},body:new Uint8Array(bytes)});
  if(!response.ok)throw conflict('Scanner rejected the upload. Inspect the destination before retrying.');
  const saved=await response.json() as {ok?:boolean;size?:number};
  if(saved.ok!==true||saved.size!==bytes.length)throw conflict('Upload not confirmed; inspect the scanner before retrying.');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const result=await ctx.db.transaction(async tx=>{
    const [file]=await tx.insert(fileInstances).values({orgId:ctx.orgId,rootId:root.id,deviceId:root.device_id,displayPath,canonicalPath:canonical,fileName:name,ext,mime,size:bytes.length,mtime:ctx.now(),availability:'AVAILABLE',fileType:kind,probeState:'PENDING',tech,stableObservations:2}).onConflictDoNothing().returning({id:fileInstances.id});
    // Scanner may have indexed the same newly written path before this transaction.
    const fileId=file?.id??rows<{id:string}>(await tx.execute(sql`select id from file_instances where org_id=${ctx.orgId} and root_id=${root.id} and canonical_path=${canonical} and archived_at is null and size=${bytes.length} and file_type::text=${kind}`))[0]?.id;
    if(!fileId)throw conflict('Uploaded file could not be indexed; inspect destination.');
    const [asset]=await tx.insert(logicalAssets).values({orgId:ctx.orgId,brandId:input.brandId,projectId:input.projectId??null,kind,title:input.fileName,source:'gateway-upload'}).returning({id:logicalAssets.id});
    const [version]=await tx.insert(assetVersions).values({orgId:ctx.orgId,assetId:asset!.id,isMaster:true,createdBy:ctx.userId}).returning({id:assetVersions.id});
    await tx.insert(assetFileLinks).values({orgId:ctx.orgId,assetVersionId:version!.id,fileInstanceId:fileId,primaryPreference:true,linkReason:'gateway-upload'});
    await tx.update(logicalAssets).set({selectedVersionId:version!.id}).where(eq(logicalAssets.id,asset!.id));
    return {fileId,assetId:asset!.id,versionId:version!.id,fileName:name,mime,size:bytes.length,sha256,brandId:input.brandId,projectId:input.projectId??null,tech};
  });
  await audit(ctx,'ai_gateway.media.upload',{type:'file_instance',id:result.fileId},undefined,{requestId,brandId:input.brandId,size:bytes.length,mime,sha256});
  return result;
}
