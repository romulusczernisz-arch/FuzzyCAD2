type OnshapeFetchContext = {
  route: string;
  operation: string;
};

type OnshapeApiCallRecord = {
  timestamp: string;
  route: string;
  operation: string;
  status: number;
  ok: boolean;
  endpoint: string;
  durationMs: number;
  rateRemaining: string | null;
  retryAfter: string | null;
};

type OnshapeApiUsageSnapshot = {
  totalCalls: number;
  byRoute: Record<string, number>;
  byOperation: Record<string, number>;
  recentCalls: OnshapeApiCallRecord[];
};

const MAX_RECENT_CALLS = 200;

let totalCalls = 0;
const byRoute: Record<string, number> = {};
const byOperation: Record<string, number> = {};
const recentCalls: OnshapeApiCallRecord[] = [];

function getHeader(res: Response, names: string[]) {
  for (const name of names) {
    const value = res.headers.get(name);

    if (value !== null) {
      return value;
    }
  }

  return null;
}

function incrementCounter(counter: Record<string, number>, key: string) {
  counter[key] = (counter[key] ?? 0) + 1;
}

function recordOnshapeApiCall(record: OnshapeApiCallRecord) {
  totalCalls += 1;
  incrementCounter(byRoute, record.route);
  incrementCounter(byOperation, record.operation);

  recentCalls.unshift(record);

  if (recentCalls.length > MAX_RECENT_CALLS) {
    recentCalls.pop();
  }
}

export async function onshapeFetch(
  endpoint: string,
  init: RequestInit,
  context: OnshapeFetchContext,
) {
  const startedAt = Date.now();
  const res = await fetch(endpoint, init);

  const record: OnshapeApiCallRecord = {
    timestamp: new Date().toISOString(),
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
  };

  recordOnshapeApiCall(record);

  console.log("[FuzzyCAD Onshape API]", record);

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

export function getOnshapeApiUsage(): OnshapeApiUsageSnapshot {
  return {
    totalCalls,
    byRoute: { ...byRoute },
    byOperation: { ...byOperation },
    recentCalls: [...recentCalls],
  };
}

export function resetOnshapeApiUsage() {
  totalCalls = 0;

  for (const key of Object.keys(byRoute)) {
    delete byRoute[key];
  }

  for (const key of Object.keys(byOperation)) {
    delete byOperation[key];
  }

  recentCalls.length = 0;
}