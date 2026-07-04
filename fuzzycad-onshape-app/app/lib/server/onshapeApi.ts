type OnshapeFetchContext = {
  route: string;
  operation: string;
};

function getHeader(res: Response, names: string[]) {
  for (const name of names) {
    const value = res.headers.get(name);

    if (value !== null) {
      return value;
    }
  }

  return null;
}

export async function onshapeFetch(
  endpoint: string,
  init: RequestInit,
  context: OnshapeFetchContext,
) {
  const startedAt = Date.now();
  const res = await fetch(endpoint, init);

  console.log("[FuzzyCAD Onshape API]", {
    route: context.route,
    operation: context.operation,
    status: res.status,
    ok: res.ok,
    endpoint,
    durationMs: Date.now() - startedAt,
    rateRemaining: getHeader(res, [
      "X-Rate-Limit-Remaining",
      "X-RateLimit-Remaining",
      "x-rate-limit-remaining",
      "x-ratelimit-remaining",
    ]),
    retryAfter: getHeader(res, ["Retry-After", "retry-after"]),
  });

  return res;
}

export async function parseJsonOrText(res: Response): Promise<unknown> {
  const text = await res.text();

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function shouldForceRefresh(searchParams: URLSearchParams) {
  return (
    searchParams.get("force") === "1" ||
    searchParams.get("refresh") === "1"
  );
}