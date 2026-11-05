export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Calls a Sourcefold route and returns its `data`; throws with the route's own message. */
export async function callApi<T>(
  url: string,
  options: { method?: string; body?: unknown; fallback?: string } = {},
): Promise<T> {
  const { method = "GET", body, fallback = "Something went wrong. Try again." } = options;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Couldn't reach Sourcefold. Check your connection and try again.", 0);
  }
  type Body = { data?: T; error?: { message?: string } };
  let json = null as Body | null;
  try {
    json = (await res.json()) as Body;
  } catch {
    json = null;
  }
  if (!res.ok) throw new ApiError(json?.error?.message ?? fallback, res.status);
  return json?.data as T;
}

export function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
