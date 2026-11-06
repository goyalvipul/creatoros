'use client';

import { useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import {
  ACTIONS,
  ActionFields,
  ConditionFields,
  actionFor,
  conditionFor,
  matchKind,
  nid,
  type WfDef,
  type WfStep,
} from '@/components/workflow-canvas';
import { when } from '@/lib/format';

type Account = { id: string; platform?: string; displayName?: string; username?: string; accountId?: string };
type Version = { id?: string; version: number; createdAt?: string; mode?: string; definition?: WfDef; note?: string };
type Execution = {
  id: string;
  status: string;
  outcome?: string | null;
  isSimulation?: boolean;
  startedAt?: string;
  platform?: string | null;
  error?: string | null;
};

const groupOf = (step: WfStep) => (step.kind === 'condition' ? Number(step.group ?? 1) : 0);

function groups(steps: WfStep[]) {
  const map = new Map<number, Extract<WfStep, { kind: 'condition' }>[]>();
  for (const step of steps) {
    if (step.kind !== 'condition') continue;
    const g = groupOf(step);
    map.set(g, [...(map.get(g) ?? []), step]);
  }
  if (!map.size) map.set(1, []);
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

function conditionTitle(condition: Record<string, unknown>) {
  const kind = matchKind(condition);
  if (kind === 'first') return 'First message';
  if (kind === 'media') return 'Has a photo or video';
  if (kind === 'hours') return 'Time of day';
  if (kind === 'category') return 'Classification';
  if (kind === 'sender') return 'Sender';
  if (kind === 'regex') return 'Pattern';
  return 'Check message content';
}

function conditionDetail(condition: Record<string, unknown>) {
  const kind = matchKind(condition);
  const list = (key: string) => (Array.isArray(condition[key]) ? (condition[key] as string[]).join(' ') : '');
  if (kind === 'emoji') return `Contains any of ${list('emojis')}`.trim();
  if (kind === 'emoji_any') return 'Contains any emoji';
  if (kind === 'emoji_none') return 'Contains no emoji';
  if (kind === 'contains') return `Contains ${list('keywords')}`.trim();
  if (kind === 'word') return `Contains the whole word ${list('keywords')}`.trim();
  if (kind === 'exact') return `The whole message is ${list('phrases')}`.trim();
  if (kind === 'excludes') return `Does not contain ${list('keywords')}`.trim();
  if (kind === 'first') return 'This is the first message in the chat';
  if (kind === 'media') return 'The message has a photo or video';
  if (kind === 'hours') return `Hours ${condition.startHour ?? 9}–${condition.endHour ?? 17}`;
  if (kind === 'category') return list('categories');
  if (kind === 'regex') return String(condition.pattern ?? '');
  if (kind === 'sender') return list('senderIds');
  return 'Rule';
}

function actionTitle(action: Record<string, unknown>) {
  return ACTIONS.find(([id]) => id === action.type)?.[1] ?? 'Action';
}

function actionDetail(action: Record<string, unknown>) {
  if (typeof action.template === 'string') return action.template;
  if (typeof action.title === 'string') return action.title;
  if (typeof action.label === 'string') return action.label;
  if (action.type === 'stop') return 'Stop the workflow';
  if (action.type === 'create_lead') return 'Create a lead';
  return '';
}

function platformLabel(platform?: string | null) {
  if (platform === 'facebook' || platform === 'FACEBOOK') return 'Facebook';
  if (platform === 'youtube' || platform === 'YOUTUBE') return 'YouTube';
  if (platform === 'instagram' || platform === 'INSTAGRAM') return 'Instagram';
  return platform || '—';
}

function accountLabel(a: Account) {
  const name = a.displayName || (a.username ? `@${a.username}` : a.accountId) || 'Account';
  return `${platformLabel(a.platform)} · ${name}`;
}

function resultLabel(row: Execution) {
  if (row.isSimulation) return 'Simulation';
  if (row.status === 'COMPLETED') return 'Completed';
  if (row.status === 'SKIPPED') return 'Skipped';
  if (row.status === 'AWAITING_APPROVAL') return 'Waiting for approval';
  if (row.status === 'FAILED' || row.status === 'BLOCKED') return 'Stopped';
  return row.status;
}

export function WorkflowStudio({
  name,
  status,
  mode,
  latestVersion,
  testedVersion,
  activeVersion,
  versions,
  accounts,
  connectionIds,
  def,
  executions,
  error,
  sim,
  testText,
  pending,
  onName,
  onMode,
  onConnections,
  onDef,
  onTestText,
  onSave,
  onActivate,
  onPause,
  onTest,
  onRestore,
}: {
  name: string;
  status: string;
  mode: string;
  latestVersion: number;
  testedVersion: number | null;
  activeVersion: number | null;
  versions: Version[];
  accounts: Account[];
  connectionIds: string[];
  def: WfDef;
  executions: Execution[];
  error: string;
  sim: { status?: string; outcome?: string; trace?: { result: string; step: string; detail: string }[] } | null;
  testText: string;
  pending: boolean;
  onName: (name: string) => void;
  onMode: (mode: string) => void;
  onConnections: (ids: string[]) => void;
  onDef: (def: WfDef) => void;
  onTestText: (text: string) => void;
  onSave: () => Promise<unknown>;
  onActivate: () => Promise<unknown>;
  onPause: () => Promise<unknown>;
  onTest: () => Promise<unknown>;
  onRestore: (version: number) => Promise<unknown>;
}) {
  const [tab, setTab] = useState<'builder' | 'activity' | 'versions' | 'settings'>('builder');
  const [side, setSide] = useState<'edit' | 'test' | 'summary'>('edit');
  const [compact, setCompact] = useState(false);
  const [selected, setSelected] = useState<string>('trigger');
  const [versionId, setVersionId] = useState(latestVersion);
  const [activity, setActivity] = useState('all');
  const live = status === 'ACTIVE' && activeVersion === latestVersion;
  const chosen = accounts.filter((a) => connectionIds.includes(a.id));
  const steps = def.steps;
  const conditionGroups = groups(steps);
  const actions = steps.filter((s): s is Extract<WfStep, { kind: 'action' }> => s.kind === 'action');
  const selectedStep = steps.find((s) => s.id === selected) ?? null;
  const selectedGroup = selectedStep?.kind === 'condition' ? groupOf(selectedStep) : conditionGroups[0]?.[0] ?? 1;

  function setSteps(next: WfStep[]) {
    onDef({ ...def, steps: next });
  }
  function addCondition(group: number) {
    const step: WfStep = {
      kind: 'condition',
      id: nid('c'),
      group,
      condition: conditionFor('emoji', {}),
    };
    const at = steps.findIndex((s) => s.kind === 'action');
    const next = [...steps];
    next.splice(at === -1 ? next.length : at, 0, step);
    setSteps(next);
    setSelected(step.id);
    setSide('edit');
  }
  function addGroup() {
    const nextGroup = Math.max(...conditionGroups.map(([g]) => g), 0) + 1;
    addCondition(nextGroup);
  }
  function addAction() {
    const step: WfStep = { kind: 'action', id: nid('a'), action: actionFor('queue_approval') };
    setSteps([...steps, step]);
    setSelected(step.id);
    setSide('edit');
  }
  function remove(id: string) {
    setSteps(steps.filter((s) => s.id !== id));
    setSelected('trigger');
  }

  const filtered = executions.filter((row) => {
    if (activity === 'sim') return row.isSimulation;
    if (activity === 'skipped') return row.status === 'SKIPPED';
    if (activity === 'done') return row.status === 'COMPLETED' && !row.isSimulation;
    return true;
  });
  const shownVersion = versions.find((v) => v.version === versionId) ?? versions[0];
  const modeLabel = mode === 'APPROVAL' ? 'Approval required' : mode === 'AUTOMATIC' ? 'Fully automatic' : 'Draft only';

  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">Automation</p>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className={`rounded-full px-2 py-0.5 text-xs ${live ? 'bg-[#e6f4ee] text-[#1d5748]' : 'bg-panel2'}`}>
              {live ? `Live v${latestVersion}` : status === 'PAUSED' ? `Paused v${latestVersion}` : `Draft v${latestVersion}`}
            </span>
            <span>{modeLabel}</span>
            <span>{chosen.map(accountLabel).join(' · ') || 'No account selected'}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => { setTab('builder'); setSide('test'); }}>
            Test workflow
          </Button>
          <Button type="button" onClick={() => void onSave()}>
            Save version
          </Button>
          <Button type="button" variant="primary" disabled={pending || live} onClick={() => void onActivate()}>
            {live ? 'Live' : 'Activate'}
          </Button>
        </div>
      </div>
      {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-4 flex gap-4 border-b border-border text-sm">
        {(
          [
            ['builder', 'Builder'],
            ['activity', `Activity ${executions.length}`],
            ['versions', `Versions ${versions.length || latestVersion}`],
            ['settings', 'Settings'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`-mb-px border-b-2 px-1 py-2 ${tab === id ? 'border-accent font-semibold' : 'border-transparent text-muted'}`}
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'builder' ? (
        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="rounded-2xl border border-border bg-panel p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">Workflow flow</h2>
                <p className="text-xs text-muted">
                  One trigger · {conditionGroups.length} condition group{conditionGroups.length === 1 ? '' : 's'} · {actions.length} action{actions.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex rounded-lg border border-border p-0.5 text-xs">
                <button type="button" className={`rounded-md px-2 py-1 ${!compact ? 'bg-panel2' : ''}`} onClick={() => setCompact(false)}>
                  Flow
                </button>
                <button type="button" className={`rounded-md px-2 py-1 ${compact ? 'bg-panel2' : ''}`} onClick={() => setCompact(true)}>
                  Compact
                </button>
              </div>
            </div>
            <FlowCard
              kicker="When · Event"
              title={def.trigger.event === 'COMMENT_RECEIVED' ? 'A comment arrives' : 'A direct message arrives'}
              detail={chosen.length ? chosen.map((a) => platformLabel(a.platform)).join(' · ') : 'Choose an account in Settings'}
              note="One event starts a run. Every selected account shares this workflow."
              selected={selected === 'trigger'}
              compact={compact}
              onClick={() => { setSelected('trigger'); setSide('edit'); }}
            />
            <Arrow />
            <div className="rounded-2xl border border-[#b7e0c8] bg-[#e6f4ee] p-3">
              <p className="text-center text-xs uppercase tracking-wide text-[#1d5748]">Run when</p>
              <p className="text-center font-semibold">Any group matches (OR)</p>
              {!compact ? <p className="text-center text-xs text-muted">Inside each group, all rules must match (AND)</p> : null}
              {conditionGroups.map(([group, rows]) => (
                <div key={group} className="mt-3 rounded-xl border border-border bg-panel p-3">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-semibold">Group {group}</span>
                    <span className="text-muted">All conditions required · AND</span>
                  </div>
                  {rows.map((step) => (
                    <div key={step.id} className="mb-2 flex items-start gap-2">
                      <button
                        type="button"
                        className={`min-w-0 flex-1 rounded-xl border p-3 text-left ${selected === step.id ? 'border-accent ring-1 ring-accent' : 'border-border'}`}
                        onClick={() => { setSelected(step.id); setSide('edit'); }}
                      >
                        <span className="text-xs text-muted">If · rule</span>
                        <span className="mt-1 block font-medium">{conditionTitle(step.condition)}</span>
                        {!compact ? <span className="mt-1 block text-sm text-muted">{conditionDetail(step.condition)}</span> : null}
                      </button>
                      <button type="button" className="mt-3 text-xs text-muted" aria-label="Remove condition" onClick={() => remove(step.id)}>
                        Remove
                      </button>
                    </div>
                  ))}
                  <button type="button" className="mt-1 w-full rounded-lg border border-dashed border-border py-2 text-sm" onClick={() => addCondition(group)}>
                    + Add AND condition
                  </button>
                </div>
              ))}
              <button type="button" className="mt-3 w-full rounded-lg border border-dashed border-[#1d5748] py-2 text-sm text-[#1d5748]" onClick={addGroup}>
                + Add OR group
              </button>
              {!compact ? <p className="mt-1 text-center text-xs text-muted">For an alternative way to qualify</p> : null}
            </div>
            <Arrow />
            {actions.map((step) => (
              <div key={step.id} className="mb-2">
                <FlowCard
                  kicker="Then · Response"
                  title={actionTitle(step.action)}
                  detail={actionDetail(step.action)}
                  note={step.action.type === 'queue_approval' ? 'Human approval before sending' : step.action.type === 'draft_reply' ? 'Saved as a draft. Nothing is sent.' : ''}
                  selected={selected === step.id}
                  compact={compact}
                  onClick={() => { setSelected(step.id); setSide('edit'); }}
                />
                <div className="mt-1 text-right">
                  <button type="button" className="text-xs text-muted" aria-label="Remove action" onClick={() => remove(step.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <button type="button" className="mt-2 w-full rounded-lg border border-dashed border-border py-2 text-sm" onClick={addAction}>
              + Add action
            </button>
            <p className="mt-3 text-xs text-muted">
              Click a card to edit it. Adding AND narrows a group. Adding OR creates an alternative path. A new version is saved when you press Save version. The live version keeps running until you activate.
            </p>
          </section>
          <aside className="rounded-2xl border border-border bg-panel p-4">
            <div className="mb-3 flex gap-3 border-b border-border text-sm">
              {(
                [
                  ['edit', 'Edit step'],
                  ['test', 'Dry-run tester'],
                  ['summary', 'Summary'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" className={`-mb-px border-b-2 px-1 py-2 ${side === id ? 'border-accent font-semibold' : 'border-transparent text-muted'}`} onClick={() => setSide(id)}>
                  {label}
                </button>
              ))}
            </div>
            {side === 'edit' ? (
              selected === 'trigger' || !selectedStep ? (
                <Field label="Starts when">
                  <Select
                    aria-label="Starts when"
                    value={def.trigger.event}
                    onChange={(e) => onDef({ ...def, trigger: { event: e.target.value as WfDef['trigger']['event'] } })}
                  >
                    <option value="COMMENT_RECEIVED">A comment arrives</option>
                    <option value="MESSAGE_RECEIVED">A direct message arrives</option>
                  </Select>
                </Field>
              ) : selectedStep.kind === 'condition' ? (
                <div>
                  <p className="mb-2 text-xs text-muted">
                    This is part of group {selectedGroup}. All conditions in this group are joined by AND. Groups are joined by OR.
                  </p>
                  <ConditionFields
                    step={selectedStep}
                    onChange={(condition) =>
                      setSteps(steps.map((s) => (s.id === selectedStep.id && s.kind === 'condition' ? { ...s, condition } : s)))
                    }
                  />
                  <p className="mt-3 rounded-lg bg-[#e6f4ee] p-2 text-xs text-[#1d5748]">
                    Example: (contains ❤️ AND the event is a comment) OR (contains “collab” AND the event is a direct message). The event is chosen once for the whole workflow.
                  </p>
                </div>
              ) : (
                <ActionFields
                  step={selectedStep}
                  onChange={(action) =>
                    setSteps(steps.map((s) => (s.id === selectedStep.id && s.kind === 'action' ? { ...s, action } : s)))
                  }
                />
              )
            ) : null}
            {side === 'test' ? (
              <div>
                <Field label="Test message">
                  <Textarea aria-label="Test message" rows={4} value={testText} onChange={(e) => onTestText(e.target.value)} />
                </Field>
                <Button type="button" disabled={pending} onClick={() => void onTest()}>
                  Test
                </Button>
                <p className="mt-2 text-xs text-muted">A dry run never sends a reply.</p>
                {sim ? (
                  <div className="mt-3 text-sm">
                    <p className="font-medium">{resultLabel({ id: 'sim', status: sim.status ?? '', isSimulation: true })}</p>
                    <p className="text-muted">{sim.outcome}</p>
                    <ol className="mt-2 space-y-1 text-xs">
                      {(sim.trace ?? []).map((t, i) => (
                        <li key={i}>
                          {t.result}: {t.detail}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </div>
            ) : null}
            {side === 'summary' ? (
              <div className="space-y-2 text-sm">
                <p>
                  When {def.trigger.event === 'COMMENT_RECEIVED' ? 'a comment arrives' : 'a direct message arrives'}
                  {chosen.length ? ` on ${chosen.map(accountLabel).join(', ')}` : ''}, any condition group can start the actions.
                </p>
                <p className="text-muted">Tested version: {testedVersion ?? 'none'}. Latest version: {latestVersion}.</p>
                <p className="text-muted">Nothing is sent unless the mode is Fully automatic and that account is allowed to send.</p>
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}

      {tab === 'activity' ? (
        <div className="mt-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Recorded runs" value={executions.length} />
            <Stat label="Completed" value={executions.filter((e) => e.status === 'COMPLETED' && !e.isSimulation).length} />
            <Stat label="Skipped" value={executions.filter((e) => e.status === 'SKIPPED').length} />
            <Stat label="Simulations" value={executions.filter((e) => e.isSimulation).length} />
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-panel">
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <div>
                <h2 className="font-semibold">Execution history</h2>
                <p className="text-xs text-muted">These are real runs and dry runs for this workflow.</p>
              </div>
              <Select aria-label="Filter executions" value={activity} onChange={(e) => setActivity(e.target.value)}>
                <option value="all">All executions</option>
                <option value="done">Completed</option>
                <option value="skipped">Skipped</option>
                <option value="sim">Simulations</option>
              </Select>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Run</th>
                  <th className="px-4 py-2 font-medium">Platform</th>
                  <th className="px-4 py-2 font-medium">Result</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length ? (
                  filtered.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="px-4 py-2">{row.outcome || row.error || 'Run'}</td>
                      <td className="px-4 py-2">{platformLabel(row.platform)}</td>
                      <td className="px-4 py-2">{resultLabel(row)}</td>
                      <td className="px-4 py-2 text-muted">{row.startedAt ? when(row.startedAt) : ''}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-6 text-muted" colSpan={4}>
                      No executions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'versions' ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="rounded-2xl border border-border bg-panel p-4">
            <h2 className="font-semibold">Saved versions</h2>
            <p className="text-xs text-muted">Select a version to inspect it. Restore copies it into a new version.</p>
            <ul className="mt-3 space-y-2">
              {versions.map((v) => (
                <li key={v.version}>
                  <button
                    type="button"
                    className={`w-full rounded-xl border px-3 py-2 text-left ${versionId === v.version ? 'border-[#b7e0c8] bg-[#e6f4ee]' : 'border-border'}`}
                    onClick={() => setVersionId(v.version)}
                  >
                    <span className="font-medium">Version {v.version}</span>
                    {activeVersion === v.version && status === 'ACTIVE' ? <span className="ml-2 text-xs text-[#1d5748]">Live</span> : null}
                    <span className="mt-1 block text-xs text-muted">{v.createdAt ? when(v.createdAt) : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <aside className="rounded-2xl border border-border bg-panel p-4">
            <p className="text-xs uppercase tracking-wide text-muted">Version details</p>
            <h2 className="text-2xl font-semibold">Version {shownVersion?.version ?? latestVersion}</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">Steps</dt><dd>{Array.isArray(shownVersion?.definition?.steps) ? shownVersion?.definition?.steps.length : steps.length}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Mode</dt><dd>{shownVersion?.mode === 'APPROVAL' ? 'Approval required' : shownVersion?.mode === 'AUTOMATIC' ? 'Fully automatic' : modeLabel}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Status</dt><dd>{activeVersion === shownVersion?.version && status === 'ACTIVE' ? 'Live' : 'Saved'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Test</dt><dd>{testedVersion === shownVersion?.version ? 'Tested' : 'Not tested'}</dd></div>
            </dl>
            <Button className="mt-4 w-full" type="button" disabled={!shownVersion || shownVersion.version === latestVersion} onClick={() => shownVersion && void onRestore(shownVersion.version)}>
              Restore as a new version
            </Button>
            <p className="mt-3 text-xs text-muted">Restoring does not activate it. The live version keeps running until you activate the new one.</p>
          </aside>
        </div>
      ) : null}

      {tab === 'settings' ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-border bg-panel p-4">
            <p className="text-xs uppercase tracking-wide text-muted">Workflow configuration</p>
            <h2 className="text-2xl font-semibold">Rules and safeguards</h2>
            <Field label="Workflow name">
              <Input aria-label="Workflow name" value={name} onChange={(e) => onName(e.target.value)} />
            </Field>
            <Field label="Approval mode">
              <Select aria-label="Approval mode" value={mode} onChange={(e) => onMode(e.target.value)}>
                <option value="DRAFT_ONLY">Draft only — save a reply</option>
                <option value="APPROVAL">Approval required — queue replies</option>
                <option value="AUTOMATIC">Fully automatic — send replies</option>
              </Select>
            </Field>
            <Field label="Applies to accounts">
              <div className="space-y-1">
                {accounts.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={connectionIds.includes(a.id)}
                      onChange={(e) =>
                        onConnections(e.target.checked ? [...connectionIds, a.id] : connectionIds.filter((id) => id !== a.id))
                      }
                    />
                    {accountLabel(a)}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted">
                Facebook runs on a new Page message or comment. YouTube runs on a comment newer than the first import. YouTube has no direct messages.
              </p>
            </Field>
            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
              <div>
                <p className="font-medium">Workflow enabled</p>
                <p className="text-xs text-muted">Pausing stops new events from running this workflow.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={status === 'ACTIVE'}
                aria-label="Workflow enabled"
                disabled={pending}
                className={`h-7 w-12 rounded-full ${status === 'ACTIVE' ? 'bg-[#1d5748]' : 'bg-border'}`}
                onClick={() => void (status === 'ACTIVE' ? onPause() : onActivate())}
              >
                <span className={`block h-5 w-5 rounded-full bg-white ${status === 'ACTIVE' ? 'ml-6' : 'ml-1'}`} />
              </button>
            </div>
            <p className="mt-4 text-xs text-muted">A cooldown per sender and a daily reply cap are not stored on the workflow. Automatic sends still stop at the account’s own daily cap.</p>
          </section>
          <section className="rounded-2xl border border-border bg-panel p-4">
            <h2 className="font-semibold">Safety and publishing</h2>
            <p className="mt-2 text-sm text-muted">A reply is not sent unless the mode is Fully automatic and you have turned sending on for that account. Approval required queues the reply for you.</p>
            <Button
              className="mt-4"
              type="button"
              onClick={() => {
                const blob = new Blob([JSON.stringify({ name, mode, definition: def }, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${name.replace(/\s+/g, '-').toLowerCase() || 'workflow'}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Export current workflow JSON
            </Button>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function FlowCard({
  kicker,
  title,
  detail,
  note,
  selected,
  compact,
  onClick,
}: {
  kicker: string;
  title: string;
  detail: string;
  note?: string;
  selected: boolean;
  compact: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={`w-full rounded-xl border bg-panel p-3 text-left ${selected ? 'border-accent ring-1 ring-accent' : 'border-border'}`}>
      <span className="text-xs uppercase tracking-wide text-muted">{kicker}</span>
      <span className="mt-1 block font-medium">{title}</span>
      {!compact && detail ? <span className="mt-1 block text-sm text-muted">{detail}</span> : null}
      {!compact && note ? <span className="mt-2 block border-t border-border pt-2 text-xs text-muted">{note}</span> : null}
    </button>
  );
}

function Arrow() {
  return <div className="py-1 text-center text-muted" aria-hidden>↓</div>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border bg-panel px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}
