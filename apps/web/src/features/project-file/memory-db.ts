// A small in-memory stand-in for the Supabase client, for the project file route tests. Unlike
// the recording fakes in src/test it applies the filters, so ownership and "not deleted" rules
// are really exercised. Only what the routes use is supported.

export type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Filter {
  test: (row: Row) => boolean;
}

class MemoryQuery implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private window: [number, number] | null = null;
  private max: number | null = null;
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row[] = [];
  private single: "none" | "maybe" | "one" = "none";
  private columns: string[] | null = null;

  constructor(
    private readonly tables: Record<string, Row[]>,
    private readonly table: string,
    private readonly log: { table: string; op: string }[],
  ) {}

  select(columns?: string) {
    if (this.mode === "select" && columns && columns !== "*") {
      this.columns = columns.split(",").map((c) => c.trim());
    }
    return this;
  }
  insert(values: Row | Row[]) {
    this.mode = "insert";
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }
  update(values: Row) {
    this.mode = "update";
    this.payload = [values];
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push({ test: (r) => r[column] === value });
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push({ test: (r) => values.includes(r[column]) });
    return this;
  }
  is(column: string, value: null) {
    this.filters.push({ test: (r) => (r[column] ?? null) === value });
    return this;
  }
  not(column: string, _operator: string, value: null) {
    this.filters.push({ test: (r) => (r[column] ?? null) !== value });
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }
  range(from: number, to: number) {
    this.window = [from, to];
    return this;
  }
  limit(count: number) {
    this.max = count;
    return this;
  }
  maybeSingle() {
    this.single = "maybe";
    return this;
  }

  private run(): Result {
    this.log.push({ table: this.table, op: this.mode });
    const rows = (this.tables[this.table] ??= []);
    if (this.mode === "insert") {
      for (const row of this.payload) {
        if (row.id !== undefined && rows.some((r) => r.id === row.id)) {
          return { data: null, error: { message: "duplicate key value", code: "23505" } };
        }
      }
      rows.push(...this.payload.map((r) => ({ ...r })));
      return { data: this.payload, error: null };
    }
    const matched = rows.filter((r) => this.filters.every((f) => f.test(r)));
    if (this.mode === "update") {
      for (const r of matched) Object.assign(r, this.payload[0]);
      return { data: matched, error: null };
    }
    if (this.mode === "delete") {
      this.tables[this.table] = rows.filter((r) => !matched.includes(r));
      return { data: matched, error: null };
    }
    let out = [...matched];
    for (const { column, ascending } of [...this.orders].reverse()) {
      out.sort((a, b) => {
        const x = a[column] as string | number;
        const y = b[column] as string | number;
        return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
      });
    }
    const columns = this.columns;
    if (columns) {
      out = out.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]])));
    }
    if (this.window) out = out.slice(this.window[0], this.window[1] + 1);
    if (this.max !== null) out = out.slice(0, this.max);
    if (this.single !== "none") return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

/** `storage`: the objects in each bucket, by folder path → file names. */
export function createMemoryDb(
  tables: Record<string, Row[]> = {},
  storage: Record<string, string[]> = {},
) {
  const log: { table: string; op: string }[] = [];
  const db = {
    from: (table: string) => new MemoryQuery(tables, table, log),
    storage: {
      from: () => ({
        list: async (path: string) => ({
          data: (storage[path] ?? []).map((name) => ({ name })),
          error: null,
        }),
      }),
    },
  };
  return { db, tables, log };
}
