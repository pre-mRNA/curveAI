type FetchLike = typeof fetch;

export const OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses";
export const DEFAULT_OPENAI_REASONING_MODEL = "gpt-4.1-mini";
export const DEFAULT_OPENAI_AI_TEST_RUNNER_MODEL = "gpt-4.1-mini";
export const DEFAULT_OPENAI_AI_TEST_JUDGE_MODEL = "gpt-4.1-mini";

type JsonSchema = Record<string, unknown>;

export async function requestOpenAiStructuredJson<T>(config: {
  apiKey: string;
  baseUrl?: string;
  model: string;
  schemaName: string;
  schema: JsonSchema;
  instructions: string;
  userPayload: Record<string, unknown>;
  fetchImpl?: FetchLike;
  maxOutputTokens?: number;
}): Promise<{ parsed: T; raw: Record<string, unknown> }> {
  const response = await (config.fetchImpl ?? fetch)(config.baseUrl ?? OPENAI_RESPONSES_API_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      instructions: config.instructions,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(config.userPayload),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: config.schemaName,
          strict: true,
          schema: config.schema,
        },
      },
      ...(typeof config.maxOutputTokens === "number" ? { max_output_tokens: config.maxOutputTokens } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI Responses request returned ${response.status}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const parsed = extractParsedPayload<T>(payload);
  if (parsed == null) {
    throw new Error("OpenAI Responses payload did not include structured output text.");
  }

  return {
    parsed,
    raw: {
      id: payload.id,
      model: payload.model,
      usage: payload.usage,
    },
  };
}

function extractParsedPayload<T>(payload: Record<string, unknown>): T | undefined {
  const parsedContent = extractParsedContent(payload);
  if (parsedContent != null) {
    return parsedContent as T;
  }

  const outputText = extractOutputText(payload);
  if (typeof outputText !== "string" || outputText.trim().length === 0) {
    return undefined;
  }

  return JSON.parse(outputText) as T;
}

function extractParsedContent(payload: Record<string, unknown>): unknown {
  for (const item of normalizeArray(payload.output)) {
    if (!isRecord(item) || item.type !== "message") {
      continue;
    }
    for (const content of normalizeArray(item.content)) {
      if (isRecord(content) && "parsed" in content && content.parsed != null) {
        return content.parsed;
      }
    }
  }
  return undefined;
}

function extractOutputText(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.output_text === "string" && payload.output_text.trim().length > 0) {
    return payload.output_text;
  }

  const fragments: string[] = [];
  for (const item of normalizeArray(payload.output)) {
    if (!isRecord(item) || item.type !== "message") {
      continue;
    }
    for (const content of normalizeArray(item.content)) {
      if (!isRecord(content)) {
        continue;
      }
      if (typeof content.text === "string" && content.text.trim().length > 0) {
        fragments.push(content.text);
      } else if (typeof content.output_text === "string" && content.output_text.trim().length > 0) {
        fragments.push(content.output_text);
      }
    }
  }

  return fragments.length > 0 ? fragments.join("\n") : undefined;
}

function normalizeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
