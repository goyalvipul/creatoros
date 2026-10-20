import { emptyCreative, type CreativeForm } from '@/components/creative-fields';

export type IdeaFormState = {
  title: string;
  format: string;
  priority: string;
  brandId: string;
} & CreativeForm;

export const blankIdea = (): IdeaFormState => ({
  title: '',
  format: 'OTHER',
  priority: 'NORMAL',
  brandId: '',
  ...emptyCreative(),
});

const keyFor = (id: string) => `cos-idea-draft:${id}`;

export function readIdeaDraft(id: string): IdeaFormState | null {
  try {
    const raw = localStorage.getItem(keyFor(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { form?: Partial<IdeaFormState> };
    if (!parsed.form || typeof parsed.form.title !== 'string') return null;
    return { ...blankIdea(), ...parsed.form };
  } catch {
    return null;
  }
}

export function hasIdeaDraft(id: string): boolean {
  return readIdeaDraft(id) !== null;
}

function isBlank(form: IdeaFormState) {
  const blank = blankIdea();
  return (Object.keys(blank) as (keyof IdeaFormState)[]).every((key) => form[key] === blank[key]);
}

/** Writes on each change so closing the tab keeps the words on this browser. */
export function writeIdeaDraft(id: string, form: IdeaFormState) {
  try {
    if (isBlank(form)) localStorage.removeItem(keyFor(id));
    else localStorage.setItem(keyFor(id), JSON.stringify({ form, at: Date.now() }));
  } catch {
    // A full disk must not block typing.
  }
}

export function clearIdeaDraft(id: string) {
  try {
    localStorage.removeItem(keyFor(id));
  } catch {
    // ignore
  }
}
