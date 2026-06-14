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
  graph?: unknown;
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
};

type DocumentQuery = {
  documentId: string;
  workspaceId: string;
  server: string;
};

type AssemblyQuery = DocumentQuery & {
  assemblyElementId: string;
};

function makeDocumentParams(query: DocumentQuery) {
  return new URLSearchParams({
    documentId: query.documentId,
    workspaceId: query.workspaceId,
    server: query.server,
  });
}

function makeAssemblyParams(query: AssemblyQuery) {
  return new URLSearchParams({
    documentId: query.documentId,
    workspaceId: query.workspaceId,
    assemblyElementId: query.assemblyElementId,
    server: query.server,
  });
}

export async function fetchOnshapeElements(
  query: DocumentQuery
): Promise<ApiResult> {
  const params = makeDocumentParams(query);
  const res = await fetch(`/api/onshape/elements?${params.toString()}`);

  return res.json() as Promise<ApiResult>;
}

export async function fetchOnshapeAssembly(
  query: AssemblyQuery
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
  query: AssemblyQuery
): Promise<ApiResult> {
  const params = new URLSearchParams({
    documentId: query.documentId,
    workspaceId: query.workspaceId,
    assemblyElementId: query.assemblyElementId,
    server: query.server,
    debugZip: "1",
  });

  const res = await fetch(`/api/onshape/assembly-gltf?${params.toString()}`);

  return res.json() as Promise<ApiResult>;
}

export async function fetchFuzzycadAssemblySummary(
  query: AssemblyQuery
): Promise<ApiResult> {
  const params = makeAssemblyParams(query);
  const res = await fetch(
    `/api/fuzzycad/assembly-summary?${params.toString()}`
  );

  return res.json() as Promise<ApiResult>;
}

export async function fetchFuzzycadRelationshipGraph(
  query: AssemblyQuery
): Promise<ApiResult> {
  const params = makeAssemblyParams(query);
  const res = await fetch(
    `/api/fuzzycad/relationship-graph?${params.toString()}`
  );

  return res.json() as Promise<ApiResult>;
}