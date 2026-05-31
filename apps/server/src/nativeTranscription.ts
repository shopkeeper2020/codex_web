import type { CodexAppServerProcess } from "./appServerProcess.js";
import { randomUUID } from "node:crypto";

const DEFAULT_CODEX_API_BASE_URL = "https://chatgpt.com/backend-api";
const DEFAULT_DESKTOP_ORIGINATOR = "Codex Desktop";

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type NativeTranscriptionInput = {
  appServer: Pick<CodexAppServerProcess, "getAuthToken">;
  audio: Buffer;
  filename?: string | null;
  contentType?: string | null;
  language?: string | null;
  fetchImpl?: FetchLike;
  apiBaseUrl?: string | null;
  originator?: string;
};

export class NativeTranscriptionError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
  ) {
    super(message);
    this.name = "NativeTranscriptionError";
  }
}

export async function transcribeNativeAudio(
  input: NativeTranscriptionInput,
): Promise<string> {
  if (input.audio.length === 0) {
    throw new NativeTranscriptionError("Missing audio data", 400);
  }

  const firstToken = await input.appServer.getAuthToken({
    refreshToken: false,
  });
  if (!firstToken) {
    throw new NativeTranscriptionError(
      "Sign in to ChatGPT in Codex Desktop to use native dictation.",
      401,
    );
  }

  const firstResponse = await postTranscription(input, firstToken);
  if (firstResponse.status === 401) {
    const refreshedToken = await input.appServer.getAuthToken({
      refreshToken: true,
    });
    if (!refreshedToken) {
      throw new NativeTranscriptionError(
        "Codex Desktop sign-in expired. Reopen Desktop and sign in again.",
        401,
      );
    }
    return await readTranscriptionResponse(
      await postTranscription(input, refreshedToken),
    );
  }

  return await readTranscriptionResponse(firstResponse);
}

async function postTranscription(
  input: NativeTranscriptionInput,
  token: string,
): Promise<Response> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const multipart = buildTranscriptionMultipart(input);

  const headers = buildDesktopTranscriptionHeaders({
    token,
    originator: input.originator ?? DEFAULT_DESKTOP_ORIGINATOR,
  });
  headers["Content-Type"] = `multipart/form-data; boundary=${multipart.boundary}`;

  return await fetchImpl(resolveTranscribeUrl(input.apiBaseUrl), {
    method: "POST",
    headers,
    body: new Uint8Array(multipart.body),
  });
}

function buildDesktopTranscriptionHeaders(input: {
  token: string;
  originator: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.token}`,
    "OAI-Language": "en",
    "X-OpenAI-Attach-Auth": "1",
    "X-OpenAI-Attach-Integrity-State": "1",
    originator: input.originator,
    "User-Agent": desktopUserAgent(),
  };
  const accountId = accountIdFromJwt(input.token);
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;
  return headers;
}

function buildTranscriptionMultipart(input: NativeTranscriptionInput): {
  body: Buffer;
  boundary: string;
} {
  const boundary = `----codex-transcribe-${randomUUID()}`;
  const contentType = normalizeContentType(input.contentType);
  const filename = sanitizeFilename(input.filename, contentType);
  const chunks: Buffer[] = [];
  const push = (value: string): void => {
    chunks.push(Buffer.from(value, "utf8"));
  };

  push(`--${boundary}\r\n`);
  push(
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`,
  );
  push(`Content-Type: ${contentType}\r\n\r\n`);
  chunks.push(input.audio);
  push("\r\n");

  const language = input.language?.trim();
  if (language) {
    push(`--${boundary}\r\n`);
    push('Content-Disposition: form-data; name="language"\r\n\r\n');
    push(`${language}\r\n`);
  }

  push(`--${boundary}--\r\n`);
  return { body: Buffer.concat(chunks), boundary };
}

async function readTranscriptionResponse(response: Response): Promise<string> {
  if (!response.ok) {
    const detail = await safeErrorText(response);
    throw new NativeTranscriptionError(
      `Native transcription failed (${response.status})${detail ? `: ${detail}` : ""}`,
      response.status === 401 || response.status === 403 ? response.status : 502,
    );
  }
  const text = await response.text();
  if (!text.trim()) return "";
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed) && typeof parsed.text === "string") {
      return parsed.text;
    }
    const body = isRecord(parsed) ? parsed.body : null;
    if (isRecord(body) && typeof body.text === "string") {
      return body.text;
    }
  } catch {
    return text;
  }
  throw new NativeTranscriptionError(
    "Native transcription returned an unexpected response.",
    502,
  );
}

function resolveTranscribeUrl(apiBaseUrl?: string | null): string {
  const rawBase =
    apiBaseUrl?.trim() ||
    process.env.CODEX_API_BASE_URL?.trim() ||
    DEFAULT_CODEX_API_BASE_URL;
  const base = rawBase.replace(/\/+$/, "");
  return `${base}/transcribe`;
}

function normalizeContentType(contentType?: string | null): string {
  const value = contentType?.trim();
  return value && /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+/u.test(value)
    ? value
    : "audio/webm";
}

function sanitizeFilename(
  filename: string | null | undefined,
  contentType: string,
): string {
  const fallbackExtension = contentType.split(/[;/]/)[0]?.split("/")[1] || "webm";
  const clean = filename?.replace(/["\r\n]/g, "").trim();
  return clean || `codex.${fallbackExtension}`;
}

function accountIdFromJwt(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as unknown;
    const auth = isRecord(parsed)
      ? parsed["https://api.openai.com/auth"]
      : null;
    const accountId = isRecord(auth) ? auth.chatgpt_account_id : null;
    return typeof accountId === "string" && accountId ? accountId : null;
  } catch {
    return null;
  }
}

function desktopUserAgent(): string {
  const platform =
    process.platform === "win32"
      ? "Windows NT 10.0"
      : process.platform === "darwin"
        ? "Macintosh; Intel Mac OS X"
        : "X11; Linux";
  return `Codex Desktop/26.527.3686.0 (${platform}; ${process.arch})`;
}

async function safeErrorText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
