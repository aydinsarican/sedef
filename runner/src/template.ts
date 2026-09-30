/** Tiny mustache-style renderer: {{a.b.c}} → value; missing → ''. No logic, no HTML escaping. */
export function render(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, key: string) => {
    let cur: unknown = vars;
    for (const k of key.split('.')) {
      if (cur === null || typeof cur !== 'object') { cur = undefined; break; }
      cur = (cur as Record<string, unknown>)[k];
    }
    if (cur === undefined || cur === null) return '';
    return typeof cur === 'object' ? JSON.stringify(cur, null, 2) : String(cur);
  });
}
