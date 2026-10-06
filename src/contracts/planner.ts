import { z } from "zod";

export const followUpActionTypeSchema = z.enum(["find_upstream_source", "check_qualification", "find_primary_evidence", "search_counter_evidence"]);
export type FollowUpActionType = z.infer<typeof followUpActionTypeSchema>;

export const followUpStateSchema = z.enum(["planned", "searching", "retrieving", "complete", "failed", "cancelled"]);
export type FollowUpState = z.infer<typeof followUpStateSchema>;

export type PlannerCandidate = {
  claimGroupId: string;
  proposition: string;
  triggerEvidenceIds: string[];
  actionType: FollowUpActionType;
  query: string;
  reason: string;
  expectedGain: "high" | "medium";
};
