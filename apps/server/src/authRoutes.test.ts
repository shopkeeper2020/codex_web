import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authSessionsResponseSchema,
  authStatusResponseSchema,
} from "@codex-web/api";
import { OfficialIpcBridge } from "@codex-web/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type ServerContext } from "./app.js";
import type { CodexAppServerProcess } from "./appServerProcess.js";

class FakeAppServer {
  onNotification(): () => void {
    return () => undefined;
  }

  registerServerRequestHandler(): void {}

  async warmUp(): Promise<void> {}

  getStatus(): Record<string, unknown> {
    return { initialized: true, running: true };
  }

  dispose(): void {}
}

type Harness = {
  context: ServerContext;
  root: string;
};

const harnesses: Harness[] = [];

async function createHarness(): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "codex-web-auth-routes-"));
  const context = await createServer(root, {
    officialIpc: new OfficialIpcBridge(""),
    appServer: new FakeAppServer() as unknown as CodexAppServerProcess,
  });
  const harness = { context, root };
  harnesses.push(harness);
  return harness;
}

async function closeHarness(harness: Harness): Promise<void> {
  await harness.context.app.close();
  rmSync(harness.root, { recursive: true, force: true });
}

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (harness) await closeHarness(harness);
  }
});

describe("auth routes", () => {
  it("validates auth request and response envelopes on real routes", async () => {
    const { context } = await createHarness();

    const shortPasswordResponse = await context.app.inject({
      method: "POST",
      url: "/api/settings/password",
      payload: { password: "short" },
    });
    expect(shortPasswordResponse.statusCode).toBe(400);

    const updatePasswordResponse = await context.app.inject({
      method: "POST",
      url: "/api/settings/password",
      payload: { password: "correct-password" },
    });
    expect(updatePasswordResponse.statusCode).toBe(200);
    expect(updatePasswordResponse.json()).toEqual({ data: { ok: true } });

    const malformedLoginResponse = await context.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {},
    });
    expect(malformedLoginResponse.statusCode).toBe(400);

    const wrongLoginResponse = await context.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "wrong-password" },
    });
    expect(wrongLoginResponse.statusCode).toBe(401);

    const loginResponse = await context.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "correct-password" },
    });
    expect(loginResponse.statusCode).toBe(200);
    const loginPayload = authStatusResponseSchema.parse(loginResponse.json());
    expect(loginPayload.data.authenticated).toBe(true);
    expect(loginPayload.data.sessionExpiresAtIso).toBeTruthy();

    const sessionsResponse = await context.app.inject({
      method: "GET",
      url: "/api/auth/sessions",
    });
    expect(sessionsResponse.statusCode).toBe(200);
    const sessionsPayload = authSessionsResponseSchema.parse(
      sessionsResponse.json(),
    );
    expect(sessionsPayload.data).toHaveLength(1);
    expect(sessionsPayload.data[0]?.id).toBeTruthy();

    const revokeResponse = await context.app.inject({
      method: "POST",
      url: "/api/auth/sessions/revoke",
      payload: { sessionId: sessionsPayload.data[0]?.id },
    });
    expect(revokeResponse.statusCode).toBe(200);
    expect(revokeResponse.json()).toEqual({ data: { ok: true } });
  });
});
