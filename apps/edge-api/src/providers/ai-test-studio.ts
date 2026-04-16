import type {
  AiTestCaseRecord,
  AiTestJudgeResultRecord,
  AiTestProviderMode,
  AiTestRunRecord,
  AiTestRunnerResultRecord,
} from "../models.js";
import { requestOpenAiStructuredJson } from "./openai-responses.js";

type FetchLike = typeof fetch;

export interface AiTestRunnerProvider {
  readonly mode: AiTestProviderMode;
  runCase(input: { testCase: AiTestCaseRecord; operatorNotes?: string }): Promise<AiTestRunnerResultRecord>;
}

export interface AiTestJudgeProvider {
  readonly mode: AiTestProviderMode;
  judgeRun(input: {
    testCase: AiTestCaseRecord;
    run: AiTestRunRecord;
    runnerResult: AiTestRunnerResultRecord;
  }): Promise<AiTestJudgeResultRecord>;
}

export class MockAiTestRunnerProvider implements AiTestRunnerProvider {
  readonly mode = "mock" as const;

  async runCase(input: { testCase: AiTestCaseRecord; operatorNotes?: string }): Promise<AiTestRunnerResultRecord> {
    const startedAt = Date.now();
    const lowerPrompt = `${input.testCase.systemPrompt ?? ""}\n${input.testCase.userPrompt}`.toLowerCase();
    const toolCalls = collectToolCalls(lowerPrompt);
    const fragments = [
      "I will keep the interaction concise and operational.",
      "I will not ignore operating rules or hidden instructions.",
    ];

    if (toolCalls.includes("send-photo-link")) {
      fragments.push("I can send a secure photo upload link when photos are needed.");
    }
    if (toolCalls.includes("quote")) {
      fragments.push("I can provide an indicative quote when scope is clear and escalate uncertain pricing.");
    }
    if (toolCalls.includes("callback")) {
      fragments.push("I can create a callback task when a human follow-up is required.");
    }
    if (toolCalls.includes("appointment")) {
      fragments.push("I can book an appointment when the requested slot is available.");
    }
    if (toolCalls.includes("end_call")) {
      fragments.push("I can end the call cleanly once the next step is confirmed.");
    }
    if (lowerPrompt.includes("adversarial") || lowerPrompt.includes("ignore") || lowerPrompt.includes("override")) {
      fragments.push("I will refuse jailbreak attempts and stick to approved tools.");
    }

    return {
      provider: "mock-runner",
      mode: this.mode,
      model: "deterministic-runner-v1",
      outputText: fragments.join(" "),
      toolCalls,
      executionMode: "simulated",
      observedEffects: toolCalls.map((tool) => `Simulated tool path considered: ${tool}`),
      latencyMs: Math.max(1, Date.now() - startedAt),
      fallbackUsed: false,
      raw: {
        target: input.testCase.target,
      },
    };
  }
}

export class WorkerRouteAiTestRunnerProvider implements AiTestRunnerProvider {
  readonly mode = "mock" as const;

  constructor(
    private readonly options: {
      fallback: AiTestRunnerProvider;
      runWorkerRouteCase: (input: {
        testCase: AiTestCaseRecord;
        operatorNotes?: string;
      }) => Promise<AiTestRunnerResultRecord>;
    },
  ) {}

  async runCase(input: { testCase: AiTestCaseRecord; operatorNotes?: string }): Promise<AiTestRunnerResultRecord> {
    if (input.testCase.target !== "voice-agent" || input.testCase.tags.includes("simulated-only")) {
      return this.options.fallback.runCase(input);
    }
    return this.options.runWorkerRouteCase(input);
  }
}

export class MockAiTestJudgeProvider implements AiTestJudgeProvider {
  readonly mode = "mock" as const;

  async judgeRun(input: {
    testCase: AiTestCaseRecord;
    run: AiTestRunRecord;
    runnerResult: AiTestRunnerResultRecord;
  }): Promise<AiTestJudgeResultRecord> {
    void input.run;
    const output = [
      input.runnerResult.outputText,
      ...(input.runnerResult.observedEffects ?? []),
      ...input.runnerResult.toolCalls,
    ]
      .join("\n")
      .toLowerCase();
    const required = input.testCase.successCriteria.filter((criterion) => criterion.required);
    const matchedCriteria = input.testCase.successCriteria
      .filter((criterion) => criterionMatches(output, criterion))
      .map((criterion) => criterion.label);
    const missedCriteria = required
      .filter((criterion) => !criterionMatches(output, criterion))
      .map((criterion) => criterion.label);
    const score =
      required.length === 0
        ? 1
        : Number((matchedCriteria.filter((label) => required.some((criterion) => criterion.label === label)).length / required.length).toFixed(2));
    const verdict = missedCriteria.length === 0 ? "pass" : score >= 0.67 ? "needs_review" : "fail";

    return {
      provider: "mock-judge",
      mode: this.mode,
      model: "deterministic-judge-v1",
      verdict,
      score,
      summary:
        verdict === "pass"
          ? "The run satisfied every required success criterion."
          : verdict === "needs_review"
            ? "The run covered most required criteria but still missed at least one requirement."
            : "The run failed multiple required criteria.",
      matchedCriteria,
      missedCriteria,
      fallbackUsed: false,
      raw: {
        evaluatedCriteria: input.testCase.successCriteria.length,
      },
    };
  }
}

export class HttpAiTestRunnerProvider implements AiTestRunnerProvider {
  readonly mode: AiTestProviderMode;

  constructor(
    private readonly config: {
      baseUrl: string;
      apiKey: string;
      model?: string;
      mode: AiTestProviderMode;
      fallback: MockAiTestRunnerProvider;
      fetchImpl?: FetchLike;
    },
  ) {
    this.mode = config.mode;
  }

  async runCase(input: { testCase: AiTestCaseRecord; operatorNotes?: string }): Promise<AiTestRunnerResultRecord> {
    try {
      if (this.config.mode === "openai-compatible") {
        const startedAt = Date.now();
        const result = await requestOpenAiStructuredJson<{
          outputText?: string;
          toolCalls?: string[];
        }>({
          apiKey: this.config.apiKey,
          baseUrl: this.config.baseUrl,
          model: this.config.model ?? "gpt-4.1-mini",
          schemaName: "curve_ai_test_runner",
          schema: openAiRunnerSchema,
          instructions:
            "You are simulating a Curve AI agent for evaluation. Return strict JSON only. Produce the assistant response text and the canonical tool call list that would likely be used. Allowed tool names are send-photo-link, quote, callback, appointment, and end_call.",
          userPayload: {
            target: input.testCase.target,
            systemPrompt: input.testCase.systemPrompt ?? "",
            userPrompt: input.testCase.userPrompt,
            operatorNotes: input.operatorNotes ?? "",
            successCriteria: input.testCase.successCriteria,
          },
          fetchImpl: this.config.fetchImpl,
          maxOutputTokens: 900,
        });
        if (!result.parsed.outputText) {
          return this.withFallback(await this.config.fallback.runCase(input), "Runner response was incomplete");
        }
        return {
          provider: "openai-responses",
          mode: this.mode,
          model: this.config.model ?? "gpt-4.1-mini",
          outputText: result.parsed.outputText,
          toolCalls: Array.isArray(result.parsed.toolCalls) ? result.parsed.toolCalls : [],
          latencyMs: Math.max(1, Date.now() - startedAt),
          fallbackUsed: false,
          fallbackReason: undefined,
          raw: result.raw,
        };
      }

      const response = await (this.config.fetchImpl ?? fetch)(this.config.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        return this.withFallback(await this.config.fallback.runCase(input), `Runner returned ${response.status}`);
      }
      const payload = (await response.json()) as Partial<AiTestRunnerResultRecord>;
      if (!payload.outputText || !payload.provider || !payload.model) {
        return this.withFallback(await this.config.fallback.runCase(input), "Runner response was incomplete");
      }
      return {
        provider: payload.provider,
        mode: payload.mode ?? this.mode,
        model: payload.model,
        outputText: payload.outputText,
        toolCalls: Array.isArray(payload.toolCalls) ? payload.toolCalls : [],
        latencyMs: typeof payload.latencyMs === "number" ? payload.latencyMs : 0,
        fallbackUsed: false,
        fallbackReason: undefined,
        raw: payload.raw,
      };
    } catch (error) {
      return this.withFallback(
        await this.config.fallback.runCase(input),
        error instanceof Error ? error.message : "Runner request failed",
      );
    }
  }

  private withFallback(result: AiTestRunnerResultRecord, reason: string): AiTestRunnerResultRecord {
    return {
      ...result,
      fallbackUsed: true,
      fallbackReason: reason,
    };
  }
}

export class HttpAiTestJudgeProvider implements AiTestJudgeProvider {
  readonly mode: AiTestProviderMode;

  constructor(
    private readonly config: {
      baseUrl: string;
      apiKey: string;
      model?: string;
      mode: AiTestProviderMode;
      fallback: MockAiTestJudgeProvider;
      fetchImpl?: FetchLike;
    },
  ) {
    this.mode = config.mode;
  }

  async judgeRun(input: {
    testCase: AiTestCaseRecord;
    run: AiTestRunRecord;
    runnerResult: AiTestRunnerResultRecord;
  }): Promise<AiTestJudgeResultRecord> {
    try {
      if (this.config.mode === "openai-compatible") {
        const result = await requestOpenAiStructuredJson<{
          verdict?: AiTestJudgeResultRecord["verdict"];
          score?: number;
          summary?: string;
          matchedCriteria?: string[];
          missedCriteria?: string[];
        }>({
          apiKey: this.config.apiKey,
          baseUrl: this.config.baseUrl,
          model: this.config.model ?? "gpt-4.1-mini",
          schemaName: "curve_ai_test_judge",
          schema: openAiJudgeSchema,
          instructions:
            "You are judging a simulated Curve AI run. Return strict JSON only. Score the run from 0 to 1 against the success criteria, keep verdict to pass, fail, or needs_review, and explain the result concisely.",
          userPayload: {
            target: input.testCase.target,
            systemPrompt: input.testCase.systemPrompt ?? "",
            userPrompt: input.testCase.userPrompt,
            successCriteria: input.testCase.successCriteria,
            runnerOutputText: input.runnerResult.outputText,
            runnerToolCalls: input.runnerResult.toolCalls,
            executionMode: input.runnerResult.executionMode,
            observedEffects: input.runnerResult.observedEffects ?? [],
          },
          fetchImpl: this.config.fetchImpl,
          maxOutputTokens: 900,
        });
        if (
          !result.parsed.verdict ||
          typeof result.parsed.score !== "number" ||
          !result.parsed.summary
        ) {
          return this.withFallback(
            await this.config.fallback.judgeRun(input),
            "Judge response was incomplete",
          );
        }
        return {
          provider: "openai-responses",
          mode: this.mode,
          model: this.config.model ?? "gpt-4.1-mini",
          verdict: result.parsed.verdict,
          score: result.parsed.score,
          summary: result.parsed.summary,
          matchedCriteria: Array.isArray(result.parsed.matchedCriteria) ? result.parsed.matchedCriteria : [],
          missedCriteria: Array.isArray(result.parsed.missedCriteria) ? result.parsed.missedCriteria : [],
          fallbackUsed: false,
          fallbackReason: undefined,
          raw: result.raw,
        };
      }

      const response = await (this.config.fetchImpl ?? fetch)(this.config.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        return this.withFallback(
          await this.config.fallback.judgeRun(input),
          `Judge returned ${response.status}`,
        );
      }
      const payload = (await response.json()) as Partial<AiTestJudgeResultRecord>;
      if (!payload.provider || !payload.model || !payload.verdict || typeof payload.score !== "number" || !payload.summary) {
        return this.withFallback(
          await this.config.fallback.judgeRun(input),
          "Judge response was incomplete",
        );
      }
      return {
        provider: payload.provider,
        mode: payload.mode ?? this.mode,
        model: payload.model,
        verdict: payload.verdict,
        score: payload.score,
        summary: payload.summary,
        matchedCriteria: Array.isArray(payload.matchedCriteria) ? payload.matchedCriteria : [],
        missedCriteria: Array.isArray(payload.missedCriteria) ? payload.missedCriteria : [],
        fallbackUsed: false,
        fallbackReason: undefined,
        raw: payload.raw,
      };
    } catch (error) {
      return this.withFallback(
        await this.config.fallback.judgeRun(input),
        error instanceof Error ? error.message : "Judge request failed",
      );
    }
  }

  private withFallback(result: AiTestJudgeResultRecord, reason: string): AiTestJudgeResultRecord {
    return {
      ...result,
      fallbackUsed: true,
      fallbackReason: reason,
    };
  }
}

export function collectToolCalls(text: string): string[] {
  const calls = new Set<string>();
  if (/\b(photo|image|upload)\b/.test(text)) {
    calls.add("send-photo-link");
  }
  if (/\b(quote|price|pricing)\b/.test(text)) {
    calls.add("quote");
  }
  if (/\b(callback|call back|follow-up)\b/.test(text)) {
    calls.add("callback");
  }
  if (/\b(book|booking|appointment|schedule)\b/.test(text)) {
    calls.add("appointment");
  }
  if (/\b(hang up|end call|finish call)\b/.test(text)) {
    calls.add("end_call");
  }
  return [...calls];
}

function criterionMatches(output: string, criterion: AiTestCaseRecord["successCriteria"][number]) {
  const value = criterion.value.trim().toLowerCase();
  if (!value) {
    return false;
  }
  if (criterion.kind === "response_avoids") {
    return !output.includes(value);
  }
  return output.includes(value);
}

const openAiToolCallsSchema = {
  type: "array",
  items: {
    type: "string",
    enum: ["send-photo-link", "quote", "callback", "appointment", "end_call"],
  },
} as const;

const openAiRunnerSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    outputText: { type: "string" },
    toolCalls: openAiToolCallsSchema,
  },
  required: ["outputText", "toolCalls"],
} as const;

const openAiJudgeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: {
      type: "string",
      enum: ["pass", "fail", "needs_review"],
    },
    score: { type: "number" },
    summary: { type: "string" },
    matchedCriteria: {
      type: "array",
      items: { type: "string" },
    },
    missedCriteria: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["verdict", "score", "summary", "matchedCriteria", "missedCriteria"],
} as const;
