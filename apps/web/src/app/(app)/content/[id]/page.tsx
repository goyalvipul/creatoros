'use client';

import { useParams } from 'next/navigation';
import { IdeaEditor } from '@/components/idea-editor';

export default function EditIdeaPage() {
  const { id } = useParams<{ id: string }>();
  return <IdeaEditor ideaId={id} />;
}
