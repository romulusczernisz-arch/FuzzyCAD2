import { onshapeFetch, parseJsonOrText } from "./onshapeApi";

type ElementsInput = {
  server: string;
  documentId: string;
  workspaceId: string;
  accessToken: string;
  route: string;
  force?: boolean;
};

type ElementsResult = {
  ok: boolean;
  status: number;
  endpoint: string;
  data: unknown;
  cache: "hit" | "miss" | "bypass";
};

type CacheEntry = {
  expiresAt: number;
  endpoint: string;
  data: unknown;
};

const ELEMENTS_CACHE_TTL_MS = 15 * 60 * 1000;

const elementsCache = new Map<string, CacheEntry>();
const elementsInflight = new Map<string, Promise<ElementsResult>>();

function makeElementsCacheKey(input: ElementsInput) {
  return [input.server, input.documentId, input.workspaceId].join("|");
}

function makeElementsEndpoint(input: ElementsInput) {
  return `${input.server}/api/documents/d/${input.documentId}/w/${input.workspaceId}/elements`;
}

async function fetchElementsFromOnshape(
  input: ElementsInput,
): Promise<ElementsResult> {
  const endpoint = makeElementsEndpoint(input);

  const res = await onshapeFetch(
    endpoint,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: "application/json",
      },
    },
    {
      route: input.route,
      operation: "get-elements",
    },
  );

  const data = await parseJsonOrText(res);

  return {
    ok: res.ok,
    status: res.status,
    endpoint,
    data,
    cache: input.force ? "bypass" : "miss",
  };
}

export async function getCachedElements(
  input: ElementsInput,
): Promise<ElementsResult> {
  const key = makeElementsCacheKey(input);
  const now = Date.now();

  if (!input.force) {
    const cached = elementsCache.get(key);

    if (cached && cached.expiresAt > now) {
      return {
        ok: true,
        status: 200,
        endpoint: cached.endpoint,
        data: cached.data,
        cache: "hit",
      };
    }

    const pending = elementsInflight.get(key);

    if (pending) {
      return pending;
    }
  }

  const request = fetchElementsFromOnshape(input)
    .then((result) => {
      if (result.ok) {
        elementsCache.set(key, {
          expiresAt: Date.now() + ELEMENTS_CACHE_TTL_MS,
          endpoint: result.endpoint,
          data: result.data,
        });
      }

      return result;
    })
    .finally(() => {
      elementsInflight.delete(key);
    });

  if (!input.force) {
    elementsInflight.set(key, request);
  }

  return request;
}

export function clearElementsCache() {
  elementsCache.clear();
  elementsInflight.clear();
}