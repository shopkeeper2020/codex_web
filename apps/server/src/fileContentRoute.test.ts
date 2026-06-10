import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const root = mkdtempSync(join(tmpdir(), "codex-web-file-content-route-"));
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

describe("file content route", () => {
  it("serves PDF content with byte-range support", async () => {
    const { context, root } = await createHarness();
    const content = Buffer.from("%PDF-1.7\n0123456789\n");
    const filename = "譚詠麟報告.pdf";
    writeFileSync(join(root, filename), content);

    const response = await context.app.inject({
      method: "GET",
      url: `/api/files/content?root=${encodeURIComponent(root)}&path=${encodeURIComponent(filename)}`,
      headers: { range: "bytes=0-7" },
    });

    expect(response.statusCode).toBe(206);
    expect(response.headers["accept-ranges"]).toBe("bytes");
    expect(response.headers["content-range"]).toBe(
      `bytes 0-7/${content.length}`,
    );
    expect(response.headers["content-length"]).toBe("8");
    expect(String(response.headers["content-type"])).toContain(
      "application/pdf",
    );
    expect(String(response.headers["content-disposition"])).toContain(
      "filename*=UTF-8''%E8%AD%9A%E8%A9%A0%E9%BA%9F%E5%A0%B1%E5%91%8A.pdf",
    );
    expect(response.body).toBe("%PDF-1.7");
  });

  it("advertises range support on full file content responses", async () => {
    const { context, root } = await createHarness();
    const content = Buffer.from("%PDF-1.7\nfull\n");
    writeFileSync(join(root, "report.pdf"), content);

    const response = await context.app.inject({
      method: "GET",
      url: `/api/files/content?root=${encodeURIComponent(root)}&path=${encodeURIComponent("report.pdf")}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["accept-ranges"]).toBe("bytes");
    expect(response.headers["content-length"]).toBe(String(content.length));
    expect(response.body).toBe(content.toString());
  });

  it("serves MP4 content with video MIME and byte ranges", async () => {
    const { context, root } = await createHarness();
    const content = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
    writeFileSync(join(root, "joined.mp4"), content);

    const response = await context.app.inject({
      method: "GET",
      url: `/api/files/content?root=${encodeURIComponent(root)}&path=${encodeURIComponent("joined.mp4")}`,
      headers: { range: "bytes=4-7" },
    });

    expect(response.statusCode).toBe(206);
    expect(response.headers["accept-ranges"]).toBe("bytes");
    expect(response.headers["content-range"]).toBe(
      `bytes 4-7/${content.length}`,
    );
    expect(String(response.headers["content-type"])).toContain("video/mp4");
    expect(response.rawPayload).toEqual(content.subarray(4, 8));
  });
});
