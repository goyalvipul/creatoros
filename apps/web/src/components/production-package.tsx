'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useApi} from '@/lib/api';
import {ActionButton} from '@/components/ui';
type Metadata={recommendedTitle:string;description:string;caption:string;tags:string[];hashtags:string[];thumbnailText:string;thumbnailConcept:string};
type Package={id:string;post:{phase:string;detail?:string;metadata?:Record<string,Metadata>;covers?:string[];missingPlatforms?:string[]}};
export function ProductionPackage({itemId,enabled}:{itemId?:string|null;enabled:boolean}){
 const query=useApi<Package|null>(enabled&&itemId?'/comfy/production-package/'+itemId:null,{refreshInterval:10000});
 const [platform,setPlatform]=useState('youtube');
 const data=query.data;
 if(!data?.post)return null;
 const m=data.post.metadata?.[platform];
 const cover='/api/v1/comfy/production-covers/'+data.id+'/'+platform;
 return <details className="rounded-xl border border-border bg-panel p-3">
   <summary className="cursor-pointer font-semibold text-sm">Production SEO & covers <span className="text-xs font-normal text-muted">· {data.post.phase.replace(/_/g,' ').toLowerCase()}</span></summary>
   <p className="mt-2 text-xs text-muted">{data.post.detail} These are draft assets, not published posts.</p>
   {data.post.metadata&&<><div className="mt-3 flex gap-1 flex-wrap">{Object.keys(data.post.metadata).map(p=><button key={p} onClick={()=>setPlatform(p)} type="button" className={'rounded-full px-3 py-1.5 text-xs capitalize '+(p===platform?'bg-panel2 font-semibold':'text-muted')}>{p}</button>)}</div>
   {m&&<div className="mt-3 grid gap-3 sm:grid-cols-[120px_1fr]">
     <div>{data.post.covers?.includes(platform)&&<><img src={cover} alt={m.thumbnailText} className="aspect-[9/16] rounded-lg object-contain border border-border w-full"/><a href={cover} download={platform+'-cover.jpg'} className="text-xs text-accent">Download cover</a></>}</div>
     <div className="min-w-0 space-y-2"><p className="font-semibold text-sm">{m.recommendedTitle}</p><p className="text-xs whitespace-pre-wrap">{m.description}</p><p className="text-xs text-muted whitespace-pre-wrap">{m.caption}</p><p className="text-xs break-words text-muted">{m.tags.join(', ')}</p><p className="text-xs break-words text-accent">{m.hashtags.map(h=>h.startsWith('#')?h:'#'+h).join(' ')}</p><ActionButton size="sm" variant="ghost" onAction={async()=>{await navigator.clipboard.writeText([m.recommendedTitle,m.description,m.caption,m.tags.join(', '),m.hashtags.join(' ')].join('\n\n'));}}>Copy package</ActionButton></div>
   </div>}</>}
   {!!data.post.missingPlatforms?.length&&<p className="mt-2 text-xs text-muted">Unconnected platforms: {data.post.missingPlatforms.join(', ')}. Their packages stay available.</p>}
   <Link className="mt-2 block text-xs text-accent hover:underline" href="/production-runs">Open production run</Link>
 </details>;
}
