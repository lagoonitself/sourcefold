import type { FakeQuery, RecordedCall } from "./fake-db";

/**
 * Like createFakeDb, but each table has a queue of results: the Nth query on a table resolves
 * with the Nth entry (the last one repeats).
 */
export type ScriptedResult = { data: unknown; error?: { message: string; code?: string } | null };

const CHAIN = [
  "select",
  "insert",
  "update",
  "delete",
  "upsert",
  "eq",
  "in",
  "is",
  "order",
  "limit",
  "range",
  "single",
  "maybeSingle",
] as const;

export function createScriptedDb(script: Record<string, ScriptedResult[]>) {
  const queries: FakeQuery[] = [];
  const counts: Record<string, number> = {};

  const db = {
    from(table: string) {
      const index = counts[table] ?? 0;
      counts[table] = index + 1;
      const queue = script[table] ?? [{ data: null }];
      const result = queue[Math.min(index, queue.length - 1)]!;
      const calls: RecordedCall[] = [];
      const query = {
        table,
        calls,
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: result.data, error: result.error ?? null }).then(resolve);
        },
      } as unknown as FakeQuery;
      for (const method of CHAIN) {
        query[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return query;
        };
      }
      queries.push(query);
      return query;
    },
  };

  return { db, queries };
}
