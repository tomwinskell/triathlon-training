// Boundary: the Store as JSONL files. Node only; the Worker uses d1.ts.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type RecOf, type Store, parseJson, validate } from './store.ts';

function readJsonl<K extends keyof RecOf>(file: string, kind: K): RecOf[K][] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap((line, i) => {
    if (!line.trim()) return [];
    const where = `${file}:${i + 1}`;
    return [validate(kind, parseJson(line, where), where)];
  });
}

const FILES = { log: 'log.jsonl', override: 'overrides.jsonl' } as const;

/** One JSON object per line in `<dir>/log.jsonl` and `<dir>/overrides.jsonl`. */
export const fileStore = (dir: string): Store => ({
  read: async () => ({ log: readJsonl(join(dir, FILES.log), 'log'), overrides: readJsonl(join(dir, FILES.override), 'override') }),
  append: async (recs) => {
    mkdirSync(dir, { recursive: true });
    for (const { kind, rec } of recs) appendFileSync(join(dir, FILES[kind]), JSON.stringify(rec) + '\n');
  },
});
