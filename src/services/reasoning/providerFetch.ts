import { invokeCancelableIpc } from "../../utils/cancelableIpc";
import type { CleanupPromptMode } from "../../config/prompts";

type Provider = "openai" | "gemini" | "groq" | "custom";

type CleanupOperation = {
  kind: "cleanup";
  variant: "responses" | "chat-completions" | "gemini-generate";
  model: string;
  userPrompt: string;
  cleanupPromptMode?: CleanupPromptMode;
  language?: string;
  maxOutputTokens: number;
  temperature?: number;
  reasoningEffort?: string;
};

type CleanupPolicyContext = {
  cleanupPromptMode?: CleanupPromptMode;
  language?: string;
};

const asRecord = (value: unknown, label: string): Record<string, any> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, any>;
};

const exactKeys = (value: Record<string, any>, allowed: string[], label: string) => {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(`${label} contains unsupported fields`);
  }
};

const textPart = (value: unknown, label: string): string => {
  const part = asRecord(value, label);
  exactKeys(part, ["text"], label);
  if (typeof part.text !== "string") throw new Error(`${label} must contain text`);
  return part.text;
};

export function parseCleanupFetchBody(
  endpoint: string,
  rawBody: string,
  policyContext: CleanupPolicyContext = {}
): CleanupOperation {
  let body: Record<string, any>;
  try {
    body = asRecord(JSON.parse(rawBody), "Cleanup request");
  } catch {
    throw new Error("Cleanup provider request body must be valid JSON");
  }
  const pathname = new URL(endpoint).pathname.replace(/\/+$/, "");

  if (pathname.endsWith("/responses")) {
    exactKeys(
      body,
      ["model", "input", "store", "max_output_tokens", "reasoning", "text", "truncation"],
      "Responses cleanup request"
    );
    if (body.store !== false || !Array.isArray(body.input) || body.input.length !== 2) {
      throw new Error("Responses cleanup request has an invalid schema");
    }
    const policy = asRecord(body.input[0], "Cleanup policy message");
    const input = asRecord(body.input[1], "Cleanup input message");
    exactKeys(policy, ["role", "content"], "Cleanup policy message");
    exactKeys(input, ["role", "content"], "Cleanup input message");
    if (policy.role !== "developer" || input.role !== "user") {
      throw new Error("Responses cleanup roles are invalid");
    }
    if (typeof policy.content !== "string" || typeof input.content !== "string") {
      throw new Error("Responses cleanup messages must contain text");
    }
    if (body.text !== undefined) {
      const text = asRecord(body.text, "Responses text control");
      exactKeys(text, ["verbosity"], "Responses text control");
      if (text.verbosity !== "medium") throw new Error("Unsupported cleanup verbosity");
    }
    if (body.truncation !== undefined && body.truncation !== "disabled") {
      throw new Error("Cleanup truncation must remain disabled");
    }
    let reasoningEffort: string | undefined;
    if (body.reasoning !== undefined) {
      const reasoning = asRecord(body.reasoning, "Responses reasoning control");
      exactKeys(reasoning, ["effort"], "Responses reasoning control");
      reasoningEffort = reasoning.effort;
    }
    return {
      kind: "cleanup",
      variant: "responses",
      model: body.model,
      userPrompt: input.content,
      ...(policyContext.cleanupPromptMode
        ? { cleanupPromptMode: policyContext.cleanupPromptMode }
        : {}),
      ...(policyContext.language ? { language: policyContext.language } : {}),
      maxOutputTokens: body.max_output_tokens,
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    };
  }

  if (pathname.endsWith("/chat/completions")) {
    exactKeys(
      body,
      [
        "model",
        "messages",
        "store",
        "temperature",
        "max_tokens",
        "max_completion_tokens",
        "reasoning_effort",
      ],
      "Chat cleanup request"
    );
    if (body.store !== undefined && body.store !== false) {
      throw new Error("Cleanup storage must remain disabled");
    }
    if (!Array.isArray(body.messages) || body.messages.length !== 2) {
      throw new Error("Chat cleanup request has an invalid schema");
    }
    const policy = asRecord(body.messages[0], "Cleanup policy message");
    const input = asRecord(body.messages[1], "Cleanup input message");
    exactKeys(policy, ["role", "content"], "Cleanup policy message");
    exactKeys(input, ["role", "content"], "Cleanup input message");
    if (policy.role !== "system" || input.role !== "user") {
      throw new Error("Chat cleanup roles are invalid");
    }
    if (typeof policy.content !== "string" || typeof input.content !== "string") {
      throw new Error("Chat cleanup messages must contain text");
    }
    const tokenBudgets = [body.max_tokens, body.max_completion_tokens].filter(
      (value) => value !== undefined
    );
    if (tokenBudgets.length !== 1) throw new Error("Chat cleanup output budget is invalid");
    return {
      kind: "cleanup",
      variant: "chat-completions",
      model: body.model,
      userPrompt: input.content,
      ...(policyContext.cleanupPromptMode
        ? { cleanupPromptMode: policyContext.cleanupPromptMode }
        : {}),
      ...(policyContext.language ? { language: policyContext.language } : {}),
      maxOutputTokens: tokenBudgets[0],
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
      ...(body.reasoning_effort !== undefined ? { reasoningEffort: body.reasoning_effort } : {}),
    };
  }

  if (pathname.endsWith(":generateContent")) {
    exactKeys(
      body,
      ["systemInstruction", "contents", "generationConfig"],
      "Gemini cleanup request"
    );
    const systemInstruction = asRecord(body.systemInstruction, "Gemini system instruction");
    exactKeys(systemInstruction, ["parts"], "Gemini system instruction");
    if (!Array.isArray(systemInstruction.parts) || systemInstruction.parts.length !== 1) {
      throw new Error("Gemini cleanup policy is invalid");
    }
    if (!Array.isArray(body.contents) || body.contents.length !== 1) {
      throw new Error("Gemini cleanup input is invalid");
    }
    const content = asRecord(body.contents[0], "Gemini cleanup content");
    exactKeys(content, ["role", "parts"], "Gemini cleanup content");
    if (content.role !== "user" || !Array.isArray(content.parts) || content.parts.length !== 1) {
      throw new Error("Gemini cleanup input is invalid");
    }
    const generation = asRecord(body.generationConfig, "Gemini generation config");
    exactKeys(generation, ["temperature", "maxOutputTokens"], "Gemini generation config");
    const endpointModel = pathname.match(/\/models\/([^/]+):generateContent$/)?.[1] || "";
    textPart(systemInstruction.parts[0], "Gemini policy part");
    return {
      kind: "cleanup",
      variant: "gemini-generate",
      model: endpointModel,
      userPrompt: textPart(content.parts[0], "Gemini input part"),
      ...(policyContext.cleanupPromptMode
        ? { cleanupPromptMode: policyContext.cleanupPromptMode }
        : {}),
      ...(policyContext.language ? { language: policyContext.language } : {}),
      maxOutputTokens: generation.maxOutputTokens,
      ...(generation.temperature !== undefined ? { temperature: generation.temperature } : {}),
    };
  }

  throw new Error("Provider endpoint is not a cleanup operation");
}

export function createProviderFetch(
  provider: Provider,
  policyContext: CleanupPolicyContext = {}
): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const endpoint = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    if (init.method && init.method.toUpperCase() !== "POST") {
      throw new Error("Provider proxy only supports POST requests");
    }
    if (typeof init.body !== "string") {
      throw new Error("Provider proxy requires a JSON request body");
    }
    const api = window.electronAPI?.providerCleanupRequest;
    if (!api) throw new Error("Secure cleanup transport is unavailable");
    const operation = parseCleanupFetchBody(endpoint, init.body, policyContext);

    const result = await invokeCancelableIpc(init.signal as AbortSignal | null, (requestId) =>
      api({ provider, endpoint, operation }, requestId)
    );
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    });
  }) as typeof fetch;
}
