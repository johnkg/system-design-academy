/**
 * Single source of truth for supported languages.
 * To add a language: add an entry here, then drop a file named `<id>.<ext>`
 * into each pattern's `code/` (and `before/`) folder. No page code changes.
 */
export interface Language {
  id: string; // file basename in code/ folders and the value stored in localStorage
  label: string; // shown on tabs
  shiki: string; // Shiki grammar id
  ext: string; // file extension without dot
  a11y: string; // accessible name; must contain the badge text shown in the icon
  icon: string; // inline SVG markup (viewBox 0 0 32 32) shown on the language switch
}

export const languages: Language[] = [
  { id: 'javascript', label: 'JavaScript', a11y: 'JS (JavaScript)', shiki: 'javascript', ext: 'js', icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="5" fill="#f7df1e"/><text x="29" y="28" text-anchor="end" font-family="ui-monospace,Menlo,monospace" font-weight="800" font-size="15" fill="#1b1d24">JS</text></svg>' },
  { id: 'csharp', label: 'C#', a11y: 'C# (C Sharp)', shiki: 'csharp', ext: 'cs', icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 1.5 29 9v14L16 30.5 3 23V9z" fill="#7b3fa0"/><text x="16" y="21" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-weight="800" font-size="14" fill="#fff">C#</text></svg>' },
  { id: 'python', label: 'Python', a11y: 'Py (Python)', shiki: 'python', ext: 'py', icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="5" fill="#3776ab"/><text x="16" y="21.5" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-weight="800" font-size="15" fill="#fff">Py</text></svg>' },
];

export const defaultLanguage = languages[0].id;
