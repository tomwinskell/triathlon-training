// Boundary: the Store on Cloudflare D1. Typed against the few D1 methods used, so no Workers types package is needed.
import { type Rec, type Store, parseJson, validate } from './store.ts';

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T>(): Promise<{ results: T[] }>;
}
export interface D1Database {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
}

interface Row { readonly seq: number; readonly kind: Rec['kind']; readonly json: string }

export const d1Store = (db: D1Database): Store => ({
  read: async () => {
    const { results } = await db.prepare('SELECT seq, kind, json FROM entries ORDER BY seq').all<Row>();
    const of = <K extends Rec['kind']>(kind: K) => results.filter((r) => r.kind === kind).map((r) => validate(kind, parseJson(r.json, `entries #${r.seq}`), `entries #${r.seq}`));
    return { log: of('log'), overrides: of('override') };
  },
  append: async (recs) => {
    if (!recs.length) return;
    const insert = db.prepare('INSERT INTO entries (kind, json) VALUES (?, ?)');
    await db.batch(recs.map(({ kind, rec }) => insert.bind(kind, JSON.stringify(rec))));
  },
});
