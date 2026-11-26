'use client';
import {ProductionRuns} from '@/components/production-runs';
import {useMe} from '@/components/shell';
export default function ProductionRunsPage(){
 const me=useMe();
 return <div className="space-y-4"><div><h1 className="text-xl font-semibold">Production control center</h1><p className="text-sm text-muted">Manage daily video runs, stage recovery and creator authorization.</p></div><ProductionRuns enabled={me.data?.user?.role==='OWNER'}/></div>;
}
