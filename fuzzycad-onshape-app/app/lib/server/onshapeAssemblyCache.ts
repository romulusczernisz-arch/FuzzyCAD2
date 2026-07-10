import { onshapeFetch, parseJsonOrText } from "./onshapeApi";

type AssemblyInput = {
  server: string;
  documentId: string;
  workspaceId: string;
  assemblyElementId: string;
  accessToken: string;
  route: string;
  force?: boolean;
};

type AssemblyResult = {
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

const ASSEMBLY_CACHE_TTL_MS = 30 * 60 * 1000;

const assemblyCache = new Map<string, CacheEntry>();
const assemblyInflight = new Map<string, Promise<AssemblyResult>>();

function makeAssemblyCacheKey(input: AssemblyInput) {
  return [
    input.server,
    input.documentId,
    input.workspaceId,
    input.assemblyElementId,
  ].join("|");
}

function makeAssemblyEndpoint(input: AssemblyInput) {
  return `${input.server}/api/assemblies/d/${input.documentId}/w/${input.workspaceId}/e/${input.assemblyElementId}`;
}

async function fetchAssemblyFromOnshape(
  input: AssemblyInput,
): Promise<AssemblyResult> {
  const endpoint = makeAssemblyEndpoint(input);

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
      operation: "get-assembly",
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

export async function getCachedAssembly(
  input: AssemblyInput,
): Promise<AssemblyResult> {
  const key = makeAssemblyCacheKey(input);
  const now = Date.now();

  if (!input.force) {
    const cached = assemblyCache.get(key);

    if (cached && cached.expiresAt > now) {
      return {
        ok: true,
        status: 200,
        endpoint: cached.endpoint,
        data: cached.data,
        cache: "hit",
      };
    }

    const pending = assemblyInflight.get(key);

    if (pending) {
      return pending;
    }
  }

  const request = fetchAssemblyFromOnshape(input)
    .then((result) => {
      if (result.ok) {
        assemblyCache.set(key, {
          expiresAt: Date.now() + ASSEMBLY_CACHE_TTL_MS,
          endpoint: result.endpoint,
          data: result.data,
        });
      }

      return result;
    })
    .finally(() => {
      assemblyInflight.delete(key);
    });

  if (!input.force) {
    assemblyInflight.set(key, request);
  }

  return request;
}

export function clearAssemblyCache() {
  assemblyCache.clear();
  assemblyInflight.clear();
}