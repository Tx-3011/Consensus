import type { ClaimRelationType, ExtractedClaim } from "../contracts/claims";

export type ClaimOccurrenceLike = ExtractedClaim & {
  id: string;
  surface: string;
  blockId: string;
};

export type ClaimPair = {
  left: ClaimOccurrenceLike;
  right: ClaimOccurrenceLike;
};

export type ClaimGroup = {
  canonicalOccurrenceId: string;
  memberIds: string[];
};

const stopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "were", "with",
]);

export function proposeClaimPairs(occurrences: ClaimOccurrenceLike[], maxPairs = 120): ClaimPair[] {
  const pairs: Array<ClaimPair & { score: number }> = [];
  for (let leftIndex = 0; leftIndex < occurrences.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < occurrences.length; rightIndex += 1) {
      const left = occurrences[leftIndex];
      const right = occurrences[rightIndex];
      if (left.surface === right.surface) continue;
      const score = tokenOverlap(left, right);
      if (score >= 0.34) pairs.push({ left, right, score });
    }
  }
  return pairs
    .sort((a, b) => b.score - a.score || a.left.id.localeCompare(b.left.id) || a.right.id.localeCompare(b.right.id))
    .slice(0, maxPairs)
    .map(({ left, right }) => ({ left, right }));
}

export function tokenOverlap(left: ClaimOccurrenceLike, right: ClaimOccurrenceLike) {
  const leftTokens = claimTokens(left);
  const rightTokens = claimTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
  return shared / Math.min(leftTokens.size, rightTokens.size);
}

export function canAcceptEquivalent(left: ClaimOccurrenceLike, right: ClaimOccurrenceLike, relation: ClaimRelationType) {
  return relation === "equivalent" && compatibleClaimScope(left, right);
}

export function compatibleClaimScope(left: ClaimOccurrenceLike, right: ClaimOccurrenceLike) {
  return left.polarity === right.polarity
    && left.certainty === right.certainty
    && equalQualifier(left.population, right.population)
    && equalQualifier(left.timeScope, right.timeScope)
    && equalQualifier(left.units, right.units)
    && equalQualifier(left.denominator, right.denominator)
    && equalQualifier(left.conditions, right.conditions)
    && equalQualifier(left.evidenceScope, right.evidenceScope);
}

export function buildClaimGroups(occurrences: ClaimOccurrenceLike[], acceptedEquivalentPairs: ClaimPair[]): ClaimGroup[] {
  const pairKeys = new Set(acceptedEquivalentPairs.map((pair) => pairKey(pair.left.id, pair.right.id)));
  const groups: ClaimGroup[] = [];
  for (const occurrence of occurrences) {
    const compatibleGroup = groups.find((group) => group.memberIds.every((memberId) => {
      const member = occurrences.find((candidate) => candidate.id === memberId);
      if (!member || !pairKeys.has(pairKey(member.id, occurrence.id))) return false;
      return compatibleClaimScope(member, occurrence);
    }));
    if (compatibleGroup) compatibleGroup.memberIds.push(occurrence.id);
    else groups.push({ canonicalOccurrenceId: occurrence.id, memberIds: [occurrence.id] });
  }
  return groups;
}

export function pairKey(leftId: string, rightId: string) {
  return [leftId, rightId].sort().join("|");
}

function claimTokens(claim: ClaimOccurrenceLike) {
  return new Set(
    `${claim.proposition} ${claim.population ?? ""} ${claim.timeScope ?? ""} ${claim.units ?? ""} ${claim.denominator ?? ""}`
      .toLocaleLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((token) => !stopWords.has(token)) ?? [],
  );
}

function equalQualifier(left: string | null, right: string | null) {
  if (left === null || right === null) return left === right;
  return normalizeQualifier(left) === normalizeQualifier(right);
}

function normalizeQualifier(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}
