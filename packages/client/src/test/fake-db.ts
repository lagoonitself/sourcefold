/** Chainable stand-in for a Supabase query builder that records every call. */
export type RecordedCall = { method: string; args: unknown[] };

export type FakeQuery = PromiseLike<{ data: unknown; error: null }> & {
  table: string;
  calls: RecordedCall[];
  [method: string]: unknown;
};

const CHAIN_METHODS = [
  "select",
  "insert",
  "update",
  "delete",
  "upsert",
  "eq",
  "in",
  "is",
  "ilike",
  "order",
  "limit",
  "range",
  "single",
  "maybeSingle",
] as const;

export function createFakeDb(
  results: Record<string, unknown>,
  rpcResults: Record<string, unknown> = {},
) {
  const queries: FakeQuery[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];

  const db = {
    from(table: string) {
      const calls: RecordedCall[] = [];
      const query = {
        table,
        calls,
        then(resolve: (value: { data: unknown; error: null }) => unknown) {
          return Promise.resolve({ data: results[table] ?? null, error: null }).then(resolve);
        },
      } as unknown as FakeQuery;
      for (const method of CHAIN_METHODS) {
        query[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return query;
        };
      }
      queries.push(query);
      return query;
    },
    rpc(fn: string, args?: unknown) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: rpcResults[fn] ?? null, error: null });
    },
  };

  return { db, queries, rpcCalls };
}

export function callsOf(query: FakeQuery, method: string): unknown[][] {
  return query.calls.filter((c) => c.method === method).map((c) => c.args);
}
