import { z } from "zod";

export const aiTestProviderModeSchema = z.enum(["mock", "hosted", "openai-compatible"]);
export const aiTestCaseStatusSchema = z.enum(["draft", "active", "archived"]);
export const aiTestTargetSchema = z.enum(["voice-agent", "onboarding", "generic-agent"]);
export const aiTestCriterionKindSchema = z.enum(["response_contains", "response_avoids", "judge_check"]);
export const aiTestRunStatusSchema = z.enum(["running", "completed", "failed"]);
export const aiTestRunVerdictSchema = z.enum(["pass", "fail", "needs_review"]);

export const aiTestSuccessCriterionSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: aiTestCriterionKindSchema,
  value: z.string(),
  required: z.boolean().default(true),
});

export const aiTestPromptSnapshotSchema = z.object({
  target: aiTestTargetSchema,
  systemPrompt: z.string().optional(),
  userPrompt: z.string(),
});

export const aiTestCaseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  status: aiTestCaseStatusSchema,
  target: aiTestTargetSchema,
  systemPrompt: z.string().optional(),
  userPrompt: z.string(),
  tags: z.array(z.string()),
  successCriteria: z.array(aiTestSuccessCriterionSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunAt: z.string().optional(),
});

export const aiTestRunnerResultSchema = z.object({
  provider: z.string(),
  mode: aiTestProviderModeSchema,
  model: z.string(),
  outputText: z.string(),
  toolCalls: z.array(z.string()),
  latencyMs: z.number().nonnegative(),
  fallbackUsed: z.boolean().default(false),
  fallbackReason: z.string().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

export const aiTestJudgeResultSchema = z.object({
  provider: z.string(),
  mode: aiTestProviderModeSchema,
  model: z.string(),
  verdict: aiTestRunVerdictSchema,
  score: z.number().min(0).max(1),
  summary: z.string(),
  matchedCriteria: z.array(z.string()),
  missedCriteria: z.array(z.string()),
  fallbackUsed: z.boolean().default(false),
  fallbackReason: z.string().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

export const aiTestRunSchema = z.object({
  id: z.string(),
  caseId: z.string(),
  status: aiTestRunStatusSchema,
  operatorNotes: z.string().optional(),
  promptSnapshot: aiTestPromptSnapshotSchema,
  criteriaSnapshot: z.array(aiTestSuccessCriterionSchema),
  runnerResult: aiTestRunnerResultSchema.optional(),
  judgeResult: aiTestJudgeResultSchema.optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
});

export const aiTestCaseListResponseSchema = z.object({
  cases: z.array(aiTestCaseSchema),
});

export const aiTestRunListResponseSchema = z.object({
  runs: z.array(aiTestRunSchema),
});

export const aiTestCaseResponseSchema = z.object({
  case: aiTestCaseSchema,
});

export const aiTestRunResponseSchema = z.object({
  run: aiTestRunSchema,
});

export const aiTestCaseCreateInputSchema = z.object({
  slug: z.string().min(2).max(80).optional(),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  status: aiTestCaseStatusSchema.default("active"),
  target: aiTestTargetSchema.default("voice-agent"),
  systemPrompt: z.string().min(1).optional(),
  userPrompt: z.string().min(1),
  tags: z.array(z.string().min(1)).max(20).default([]),
  successCriteria: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        label: z.string().min(1),
        kind: aiTestCriterionKindSchema,
        value: z.string().min(1),
        required: z.boolean().default(true),
      }),
    )
    .min(1),
});

export const aiTestRunCreateInputSchema = z.object({
  operatorNotes: z.string().min(1).max(1000).optional(),
});

export type AiTestProviderMode = z.infer<typeof aiTestProviderModeSchema>;
export type AiTestCaseStatus = z.infer<typeof aiTestCaseStatusSchema>;
export type AiTestTarget = z.infer<typeof aiTestTargetSchema>;
export type AiTestCriterionKind = z.infer<typeof aiTestCriterionKindSchema>;
export type AiTestRunStatus = z.infer<typeof aiTestRunStatusSchema>;
export type AiTestRunVerdict = z.infer<typeof aiTestRunVerdictSchema>;
export type AiTestSuccessCriterion = z.infer<typeof aiTestSuccessCriterionSchema>;
export type AiTestPromptSnapshot = z.infer<typeof aiTestPromptSnapshotSchema>;
export type AiTestCase = z.infer<typeof aiTestCaseSchema>;
export type AiTestRunnerResult = z.infer<typeof aiTestRunnerResultSchema>;
export type AiTestJudgeResult = z.infer<typeof aiTestJudgeResultSchema>;
export type AiTestRun = z.infer<typeof aiTestRunSchema>;
export type AiTestCaseListResponse = z.infer<typeof aiTestCaseListResponseSchema>;
export type AiTestRunListResponse = z.infer<typeof aiTestRunListResponseSchema>;
export type AiTestCaseResponse = z.infer<typeof aiTestCaseResponseSchema>;
export type AiTestRunResponse = z.infer<typeof aiTestRunResponseSchema>;
export type AiTestCaseCreateInput = z.infer<typeof aiTestCaseCreateInputSchema>;
export type AiTestRunCreateInput = z.infer<typeof aiTestRunCreateInputSchema>;
