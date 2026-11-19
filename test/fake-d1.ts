// In-memory stand-in for the two D1 statements d1Store uses, to test the D1 path and the Worker without Cloudflare.
import type { D1Database } from '../src/io/d1.ts';

export function fakeD1(): D1Database & { rows: { seq: number; kind: string; json: string }[] } {
  const rows: { seq: number; kind: string; json: string }[] = [];
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...values: unknown[]) => statement(sql, values),
    all: async <T>() => ({ results: (sql.startsWith('SELECT') ? rows : []) as T[] }),
    run: () => {
      if (sql.startsWith('INSERT')) rows.push({ seq: rows.length + 1, kind: String(args[0]), json: String(args[1]) });
    },
  });
  return {
    rows,
    prepare: (sql) => statement(sql) as never,
    batch: async (statements) => { for (const s of statements) await (s as unknown as { run(): unknown }).run(); },
  };
}
