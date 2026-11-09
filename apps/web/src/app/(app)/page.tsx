'use client';

import { useState } from 'react';
import { TodayCommand } from './today-command';
import { TodayHome } from './today-home';

export default function HomePage() {
  const [plan, setPlan] = useState(false);
  if (plan) {
    return (
      <div className="space-y-3">
        <button type="button" className="text-sm font-semibold underline" onClick={() => setPlan(false)}>
          Back to today
        </button>
        <TodayCommand />
      </div>
    );
  }
  return <TodayHome onPlan={() => setPlan(true)} />;
}
