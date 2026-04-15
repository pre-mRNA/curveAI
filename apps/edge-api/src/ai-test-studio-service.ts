import { createId } from "./crypto.js";
import type {
  AiTestCaseRecord,
  AiTestRunRecord,
  AiTestSuccessCriterionRecord,
} from "./models.js";
import type { OnboardingRepository } from "./storage/repository.js";
import type { AiTestJudgeProvider, AiTestRunnerProvider } from "./providers/ai-test-studio.js";

export interface AiTestStudioProviders {
  runner: AiTestRunnerProvider;
  judge: AiTestJudgeProvider;
}

export interface CreateAiTestCaseInput {
  slug?: string;
  name: string;
  description?: string;
  status: AiTestCaseRecord["status"];
  target: AiTestCaseRecord["target"];
  systemPrompt?: string;
  userPrompt: string;
  tags: string[];
  successCriteria: Array<{
    id?: string;
    label: string;
    kind: AiTestSuccessCriterionRecord["kind"];
    value: string;
    required: boolean;
  }>;
}

export interface CreateAiTestRunInput {
  operatorNotes?: string;
}

export class AiTestStudioService {
  constructor(
    private readonly options: {
      repo: OnboardingRepository;
      providers: AiTestStudioProviders;
    },
  ) {}

  async listCases(): Promise<AiTestCaseRecord[]> {
    return this.options.repo.listAiTestCases();
  }

  async getCase(id: string): Promise<AiTestCaseRecord | undefined> {
    return this.options.repo.getAiTestCase(id);
  }

  async createCase(input: CreateAiTestCaseInput): Promise<AiTestCaseRecord> {
    const slug = normalizeSlug(input.slug ?? input.name);
    const existing = await this.options.repo.getAiTestCaseBySlug(slug);
    if (existing) {
      throw new AiTestStudioRuleError("A test case with that slug already exists.", 409);
    }
    const successCriteria = input.successCriteria.map((criterion) => ({
      id: criterion.id?.trim() || createId("aitcrit"),
      label: criterion.label.trim(),
      kind: criterion.kind,
      value: criterion.value.trim(),
      required: criterion.required,
    }));
    if (successCriteria.some((criterion) => !criterion.label || !criterion.value)) {
      throw new AiTestStudioRuleError("Every success criterion needs a non-empty label and value.", 400);
    }

    const now = new Date().toISOString();
    const testCase: AiTestCaseRecord = {
      id: createId("aitest"),
      slug,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      status: input.status,
      target: input.target,
      systemPrompt: input.systemPrompt?.trim() || undefined,
      userPrompt: input.userPrompt.trim(),
      tags: dedupe(input.tags.map((tag) => tag.trim()).filter(Boolean)),
      successCriteria,
      createdAt: now,
      updatedAt: now,
    };
    await this.options.repo.saveAiTestCase(testCase);
    return testCase;
  }

  async listRuns(caseId?: string): Promise<AiTestRunRecord[]> {
    return this.options.repo.listAiTestRuns(caseId);
  }

  async getRun(id: string): Promise<AiTestRunRecord | undefined> {
    return this.options.repo.getAiTestRun(id);
  }

  async runCase(caseId: string, input: CreateAiTestRunInput): Promise<AiTestRunRecord | undefined> {
    const testCase = await this.options.repo.getAiTestCase(caseId);
    if (!testCase) {
      return undefined;
    }
    if (testCase.status === "archived") {
      throw new AiTestStudioRuleError("Archived test cases cannot be run.", 409);
    }

    const now = new Date().toISOString();
    const draft: AiTestRunRecord = {
      id: createId("aitrun"),
      caseId: testCase.id,
      status: "running",
      operatorNotes: input.operatorNotes?.trim() || undefined,
      promptSnapshot: {
        target: testCase.target,
        systemPrompt: testCase.systemPrompt,
        userPrompt: testCase.userPrompt,
      },
      criteriaSnapshot: structuredClone(testCase.successCriteria),
      createdAt: now,
      startedAt: now,
    };
    await this.options.repo.saveAiTestRun(draft);

    try {
      const runnerResult = await this.options.providers.runner.runCase({
        testCase,
        operatorNotes: draft.operatorNotes,
      });
      const persistedRunnerResult = {
        ...runnerResult,
        raw: undefined,
      };
      const judgeResult = await this.options.providers.judge.judgeRun({
        testCase,
        run: draft,
        runnerResult: persistedRunnerResult,
      });
      const completedAt = new Date().toISOString();
      const completed: AiTestRunRecord = {
        ...draft,
        status: "completed",
        runnerResult: persistedRunnerResult,
        judgeResult,
        completedAt,
      };
      await this.options.repo.saveAiTestRun(completed);
      await this.options.repo.saveAiTestCase({
        ...testCase,
        lastRunAt: completedAt,
      });
      return completed;
    } catch (error) {
      const completedAt = new Date().toISOString();
      const failed: AiTestRunRecord = {
        ...draft,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "AI test run failed",
        completedAt,
      };
      await this.options.repo.saveAiTestRun(failed);
      await this.options.repo.saveAiTestCase({
        ...testCase,
        lastRunAt: completedAt,
      });
      return failed;
    }
  }
}

export class AiTestStudioRuleError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "AiTestStudioRuleError";
  }
}

function normalizeSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!slug) {
    throw new AiTestStudioRuleError("A test case slug could not be derived from that value.", 400);
  }
  return slug;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
