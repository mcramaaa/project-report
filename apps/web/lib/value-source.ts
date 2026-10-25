import type { ValueSource } from '@/components/source-value';

export function workbookSource(projectId: string, locator: unknown): ValueSource[] {
  if (!locator || typeof locator !== 'object') return [];
  const l = locator as { documentId?: unknown; sheet?: unknown; cell?: unknown; row?: unknown };
  if (typeof l.documentId !== 'string' || typeof l.sheet !== 'string') return [];
  const cell =
    typeof l.cell === 'string' && /^\$?[A-Z]{1,3}\$?[1-9]\d*$/i.test(l.cell)
      ? l.cell.replaceAll('$', '')
      : typeof l.row === 'number'
        ? `A${l.row}`
        : 'A1';
  return [
    {
      label: `Excel · ${l.sheet}${typeof l.cell === 'string' ? `!${l.cell}` : typeof l.row === 'number' ? ` · baris ${l.row}` : ''}`,
      href: `/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(l.documentId)}?sheet=${encodeURIComponent(l.sheet)}&cell=${encodeURIComponent(cell)}`,
    },
  ];
}

export const rabRowHref = (projectId: string, versionId: string, rowId: string) =>
  `/projects/${encodeURIComponent(projectId)}/rab/${encodeURIComponent(versionId)}#rab-row-${encodeURIComponent(rowId)}`;
