/** Pure helpers for the select modal: item shape + case-insensitive filtering. */

export interface SelectItem {
  value: string;
  label: string;
  desc?: string;
}

/** Filter items by a case-insensitive substring match on label or description. */
export function filterItems(items: SelectItem[], query: string): SelectItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (it) => it.label.toLowerCase().includes(q) || (it.desc?.toLowerCase().includes(q) ?? false),
  );
}

/** Clamp an index into a list's valid range (or 0 when empty). */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}
