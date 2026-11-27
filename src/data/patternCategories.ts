/**
 * The families a design pattern can belong to, in display order.
 * The schema, home page, compare page and cheat sheets all read this list, so a new family is one entry here.
 */
export const patternCategories = [
  { id: 'creational', label: 'Creational', blurb: 'How objects get made', color: 'var(--role-1)' },
  { id: 'structural', label: 'Structural', blurb: 'How objects fit together', color: 'var(--role-3)' },
  { id: 'behavioral', label: 'Behavioral', blurb: 'How objects talk to each other', color: 'var(--role-4)' },
  { id: 'enterprise', label: 'Enterprise', blurb: 'How code organises data access and domain logic', color: 'var(--role-2)' },
  { id: 'distributed', label: 'Distributed', blurb: 'How services cooperate across processes and networks', color: 'var(--role-5)' },
  { id: 'concurrency', label: 'Concurrency', blurb: 'How code that runs at the same time is structured', color: 'var(--role-6)' },
] as const;

export type PatternCategory = (typeof patternCategories)[number]['id'];

// A non-empty tuple of literals, which is what z.enum() needs.
export const patternCategoryIds = patternCategories.map((c) => c.id) as unknown as [PatternCategory, ...PatternCategory[]];

export const categoryLabel = (id: string): string => patternCategories.find((c) => c.id === id)?.label ?? id;
