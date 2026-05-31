import { describe, expect, it, vi } from "vitest";
import type { CodexAppServerProcess } from "./appServerProcess.js";
import { transcribeNativeAudio } from "./nativeTranscription.js";

function fakeJwt(accountId = "acct_test"): string {
  const payload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": {
        chatgpt_account_id: accountId,
      },
    }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

function fakeAppServer(tokens: Array<string | null>): {
  appServer: Pick<CodexAppServerProcess, "getAuthToken">;
  getAuthToken: ReturnType<typeof vi.fn>;
} {
  const getAuthToken = vi.fn(async () => tokens.shift() ?? null);
  return {
    appServer: { getAuthToken } as Pick<
      CodexAppServerProcess,
      "getAuthToken"
    >,
    getAuthToken,
  };
}

describe("native transcription", () => {
  it("posts recorded audio to the official transcribe endpoint with Desktop auth", async () => {
    const token = fakeJwt();
    const { appServer, getAuthToken } = fakeAppServer([token]);
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://example.test/backend-api/transcribe");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${token}`,
        "ChatGPT-Account-Id": "acct_test",
        "OAI-Language": "en",
        "X-OpenAI-Attach-Auth": "1",
        "X-OpenAI-Attach-Integrity-State": "1",
        originator: "Codex Desktop",
      });
      const headers = init?.headers as Record<string, string>;
      const contentType = headers["Content-Type"] ?? "";
      expect(contentType).toMatch(
        /^multipart\/form-data; boundary=----codex-transcribe-/u,
      );
      expect(init?.body).toBeInstanceOf(Uint8Array);
      const bodyText = Buffer.from(init?.body as Uint8Array).toString("utf8");
      const boundary = contentType.slice(
        "multipart/form-data; boundary=".length,
      );
      expect(bodyText).toContain(`--${boundary}\r\n`);
      expect(bodyText).toContain(
        'Content-Disposition: form-data; name="file"; filename="sample.webm"',
      );
      expect(bodyText).toContain("Content-Type: audio/webm");
      expect(bodyText).toContain("webm-data");
      expect(bodyText).toContain(
        'Content-Disposition: form-data; name="language"',
      );
      expect(bodyText).toContain("zh-CN");
      expect(bodyText).toContain(`--${boundary}--\r\n`);
      return new Response(JSON.stringify({ text: "你好，Codex" }), {
        status: 200,
      });
    });

    await expect(
      transcribeNativeAudio({
        appServer,
        audio: Buffer.from("webm-data"),
        filename: "sample.webm",
        contentType: "audio/webm",
        language: "zh-CN",
        fetchImpl,
        apiBaseUrl: "https://example.test/backend-api/",
      }),
    ).resolves.toBe("你好，Codex");

    expect(getAuthToken).toHaveBeenCalledWith({ refreshToken: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refreshes the app-server token once when the official endpoint returns 401", async () => {
    const expiredToken = fakeJwt("acct_old");
    const refreshedToken = fakeJwt("acct_new");
    const { appServer, getAuthToken } = fakeAppServer([
      expiredToken,
      refreshedToken,
    ]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("expired", { status: 401 }))
      .mockImplementationOnce(
        async (_input: string | URL, init?: RequestInit) => {
          expect(init?.headers).toMatchObject({
            Authorization: `Bearer ${refreshedToken}`,
            "ChatGPT-Account-Id": "acct_new",
          });
          return new Response(JSON.stringify({ body: { text: "已刷新" } }), {
            status: 200,
          });
        },
      );

    await expect(
      transcribeNativeAudio({
        appServer,
        audio: Buffer.from("webm-data"),
        fetchImpl,
        apiBaseUrl: "https://example.test/backend-api",
      }),
    ).resolves.toBe("已刷新");

    expect(getAuthToken).toHaveBeenNthCalledWith(1, { refreshToken: false });
    expect(getAuthToken).toHaveBeenNthCalledWith(2, { refreshToken: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails before network access when Desktop has no auth token", async () => {
    const { appServer } = fakeAppServer([null]);
    const fetchImpl = vi.fn();

    await expect(
      transcribeNativeAudio({
        appServer,
        audio: Buffer.from("webm-data"),
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects empty audio before requesting an auth token", async () => {
    const { appServer, getAuthToken } = fakeAppServer([fakeJwt()]);

    await expect(
      transcribeNativeAudio({
        appServer,
        audio: Buffer.alloc(0),
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(getAuthToken).not.toHaveBeenCalled();
  });
});
