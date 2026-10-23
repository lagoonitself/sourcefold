// The `{ data }` / `{ error: { message } }` envelopes every route answers with.

export function jsonData<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status });
}

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: { message } }, { status });
}
