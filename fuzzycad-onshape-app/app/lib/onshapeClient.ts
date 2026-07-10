export type OnshapeElement = {
  id: string;
  name: string;
  type?: string;
  elementType?: string;
  dataType?: string;
};

export type ApiResult = {
  endpoint?: string;
  status?: number;
  ok?: boolean;
  data?: unknown;
  state?: unknown;
  graph?: unknown;
  summary?: unknown;
  error?: string;
  action?: string;
  details?: unknown;
  counts?: unknown;
  occurrencesPreview?: unknown;
  instancesPreview?: unknown;
  featuresPreview?: unknown;
  manifest?: unknown;
  mode?: string;
  message?: string;
annotatedSelectionStlResult?: unknown;
assemblyOverlayResult?: unknown;

  generatedGeometryResult?: unknown;
  projectStateResult?: unknown;
  reconstructionResult?: unknown;
  projectState?: unknown;
};

// ── Client-side sessionStorage cache ─────────────────────────────────────────
// Keyed by endpoint URL. TTL is 30 minutes matching the server assembly cache.
// Entries are cleared when the assembly changes (force:true resets).

const SESSION_CACHE_TTL_MS = 30 * 60 * 1000;

type SessionCacheEntry = {
  expiresAt: number;
  data: ApiResult;
};

function sessionCacheGet(key: string): ApiResult | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as SessionCacheEntry;
    if (Date.now() > entry.expiresAt) {
      sessionStorage.removeItem(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function sessionCacheSet(key: string, data: ApiResult) {
  if (typeof sessionStorage === "undefined") return;
  try {
    const entry: SessionCacheEntry = {
      expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
      data,
    };
    sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // sessionStorage may be full or unavailable — fail silently
  }
}

export function clearAssemblySessionCache(query: {
  documentId: string;
  workspaceId: string;
  assemblyElementId: string;
  server: string;
}) {
  if (typeof sessionStorage === "undefined") return;
  const prefix = `fuzzycad:${query.server}:${query.documentId}:${query.workspaceId}:${query.assemblyElementId}:`;
  const keys = Object.keys(sessionStorage).filter((k) => k.startsWith(prefix));
  for (const k of keys) sessionStorage.removeItem(k);
}

// ─────────────────────────────────────────────────────────────────────────────

async function parseApiResult(res: Response): Promise<ApiResult> {
  const text = await res.text();

  if (!text) {
    return {
      ok: res.ok,
      status: res.status,
    };
  }

  try {
    const parsed = JSON.parse(text) as unknown;

    if (parsed && typeof parsed === "object") {
      return {
        ...(parsed as Record<string, unknown>),
        ok:
          "ok" in parsed
            ? Boolean((parsed as { ok?: unknown }).ok)
            : res.ok,
        status: res.status,
      } as ApiResult;
    }

    return {
      ok: res.ok,
      status: res.status,
      data: parsed,
    };
  } catch {
    return {
      ok: false,
      status: res.status,
      error: text,
    };
  }
}

export async function saveFuzzycadProject(
  query: DocumentQuery,
  projectState: unknown,
  options: {
    annotatedSelectionStl?: Blob | null;
  } = {},
): Promise<ApiResult> {
  if (options.annotatedSelectionStl) {
    const formData = new FormData();

    formData.append("documentId", query.documentId);
    formData.append("workspaceId", query.workspaceId);
    formData.append("server", query.server);
    formData.append("projectState", JSON.stringify(projectState));
    formData.append(
      "annotatedSelectionStl",
      options.annotatedSelectionStl,
      "fuzzycad-annotated-selection.stl",
    );

    const res = await fetch("/api/fuzzycad/save-project", {
      method: "POST",
      body: formData,
    });

    return parseApiResult(res);
  }

  const res = await fetch("/api/fuzzycad/save-project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: query.documentId,
      workspaceId: query.workspaceId,
      server: query.server,
      projectState,
    }),
  });

  return parseApiResult(res);
}

type DocumentQuery = {
  documentId: string;
  workspaceId: string;
  server: string;
  force?: boolean;
};

type AssemblyQuery = DocumentQuery & {
  assemblyElementId: string;
};

function appendOptionalParams(
  params: URLSearchParams,
  query: { force?: boolean },
) {
  if (query.force) {
    params.set("force", "1");
  }

  return params;
}

function makeDocumentParams(query: DocumentQuery) {
  const params = new URLSearchParams({
    documentId: query.documentId,
    workspaceId: query.workspaceId,
    server: query.server,
  });

  return appendOptionalParams(params, query);
}

function makeAssemblyParams(query: AssemblyQuery) {
  const params = new URLSearchParams({
    documentId: query.documentId,
    workspaceId: query.workspaceId,
    assemblyElementId: query.assemblyElementId,
    server: query.server,
  });

  return appendOptionalParams(params, query);
}

export async function fetchOnshapeElements(
  query: DocumentQuery,
): Promise<ApiResult> {
  const params = makeDocumentParams(query);
  const res = await fetch(`/api/onshape/elements?${params.toString()}`);

  return res.json() as Promise<ApiResult>;
}

export async function fetchOnshapeAssembly(
  query: AssemblyQuery,
): Promise<ApiResult> {
  const params = makeAssemblyParams(query);
  const res = await fetch(`/api/onshape/assembly?${params.toString()}`);

  return res.json() as Promise<ApiResult>;
}

export async function fetchOnshapeAssemblyGltf(query: AssemblyQuery) {
  const params = makeAssemblyParams(query);

  return fetch(`/api/onshape/assembly-gltf?${params.toString()}`);
}

export async function fetchOnshapeAssemblyZipManifest(
  query: AssemblyQuery,
): Promise<ApiResult> {
  const params = makeAssemblyParams(query);
  params.set("debugZip", "1");

  const res = await fetch(`/api/onshape/assembly-gltf?${params.toString()}`);

  return res.json() as Promise<ApiResult>;
}

export async function fetchFuzzycadAssemblySummary(
  query: AssemblyQuery,
): Promise<ApiResult> {
  const params = makeAssemblyParams(query);
  const url = `/api/fuzzycad/assembly-summary?${params.toString()}`;
  const cacheKey = `fuzzycad:${query.server}:${query.documentId}:${query.workspaceId}:${query.assemblyElementId}:assembly-summary`;

  if (!query.force) {
    const cached = sessionCacheGet(cacheKey);
    if (cached) return cached;
  }

  const res = await fetch(url);
  const result = await parseApiResult(res);

  if (result.ok) sessionCacheSet(cacheKey, result);

  return result;
}

export async function fetchFuzzycadRelationshipGraph(
  query: AssemblyQuery,
): Promise<ApiResult> {
  const params = makeAssemblyParams(query);
  const url = `/api/fuzzycad/relationship-graph?${params.toString()}`;
  const cacheKey = `fuzzycad:${query.server}:${query.documentId}:${query.workspaceId}:${query.assemblyElementId}:relationship-graph`;

  if (!query.force) {
    const cached = sessionCacheGet(cacheKey);
    if (cached) return cached;
  }

  const res = await fetch(url);
  const result = await parseApiResult(res);

  if (result.ok) sessionCacheSet(cacheKey, result);

  return result;
}

export async function fetchFuzzycadAssemblyData(
  query: AssemblyQuery,
): Promise<ApiResult> {
  const params = makeAssemblyParams(query);
  const url = `/api/fuzzycad/assembly-data?${params.toString()}`;
  const cacheKey = `fuzzycad:${query.server}:${query.documentId}:${query.workspaceId}:${query.assemblyElementId}:assembly-data`;

  if (!query.force) {
    const cached = sessionCacheGet(cacheKey);
    if (cached) return cached;
  }

  const res = await fetch(url);
  const result = await parseApiResult(res);

  if (result.ok) sessionCacheSet(cacheKey, result);

  return result;
}

export type OccurrenceUpdate = {
  /** Full occurrence path array (split of pathKey on "/"). */
  path: string[];
  /** 16-element row-major 4×4 transform matrix. */
  transform: number[];
};

export async function applyOnshapeOccurrenceTransforms(
  query: AssemblyQuery,
  occurrences: OccurrenceUpdate[],
): Promise<ApiResult> {
  const res = await fetch("/api/onshape/assembly-transforms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: query.documentId,
      workspaceId: query.workspaceId,
      assemblyElementId: query.assemblyElementId,
      server: query.server,
      occurrences,
    }),
  });

  return res.json() as Promise<ApiResult>;
}

export async function saveFuzzycadProjectState(
  query: DocumentQuery,
  state: unknown,
): Promise<ApiResult> {
  const res = await fetch("/api/fuzzycad/project-state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: query.documentId,
      workspaceId: query.workspaceId,
      server: query.server,
      state,
    }),
  });

  return res.json() as Promise<ApiResult>;
}

export async function loadFuzzycadProjectState(
  query: DocumentQuery,
): Promise<ApiResult> {
  const params = makeDocumentParams(query);
  const res = await fetch(`/api/fuzzycad/project-state?${params.toString()}`);

  return res.json() as Promise<ApiResult>;
}
