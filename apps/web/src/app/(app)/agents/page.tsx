import { AgentStudioCard } from '@/components/agent-studio-card';
import { AgentTasksCard } from '@/components/agent-tasks-card';

export default function AgentsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Agent Studio</h1>
        <p className="mt-1 text-sm text-muted">Configure creator workflows, schedules, resource limits and review every execution.</p>
      </header>
      <AgentStudioCard />
      <AgentTasksCard />
    </div>
  );
}
