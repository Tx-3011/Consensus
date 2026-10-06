export type RootMapping = { documentId: string; rootId: string };
export type DependencyEdge = { fromDocumentId: string; toDocumentId: string };

export function analyzeProvenanceGraph(documentIds: string[], rootMappings: RootMapping[], dependencyEdges: DependencyEdge[]) {
  const rootsByDocument = new Map<string, Set<string>>();
  for (const mapping of rootMappings) {
    const roots = rootsByDocument.get(mapping.documentId) ?? new Set<string>();
    roots.add(mapping.rootId);
    rootsByDocument.set(mapping.documentId, roots);
  }
  const documentBuckets = { mappedOnlyOneRoot: 0, mappedMultipleRoots: 0, unresolved: 0 };
  for (const id of documentIds) {
    const roots = rootsByDocument.get(id);
    if (!roots?.size) documentBuckets.unresolved += 1;
    else if (roots.size === 1) documentBuckets.mappedOnlyOneRoot += 1;
    else documentBuckets.mappedMultipleRoots += 1;
  }
  return { documentBuckets, cycles: findCycles(documentIds, dependencyEdges) };
}

export function findCycles(documentIds: string[], edges: DependencyEdge[]) {
  const adjacency = new Map(documentIds.map((id) => [id, [] as string[]]));
  for (const edge of edges) adjacency.get(edge.fromDocumentId)?.push(edge.toDocumentId);
  const cycles = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string) => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      cycles.add([...stack.slice(start), id].join(" -> "));
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    stack.push(id);
    for (const target of adjacency.get(id) ?? []) visit(target);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of documentIds) visit(id);
  return [...cycles].sort();
}

export function classifyExactContentRelationship(text: string) {
  return /\b(reprinted|republished|originally published|courtesy)\s+(from|by|at)\b/i.test(text)
    ? "REPRINT_OF" as const
    : "SAME_DOCUMENT" as const;
}
