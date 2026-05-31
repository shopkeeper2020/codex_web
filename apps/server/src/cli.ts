#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuntimeConfig } from "@codex-web/config";
import { resetLanPassword } from "./auth/config.js";
import {
  buildSyncDoctorReport,
  formatSyncDoctorResult,
  parseSyncDoctorArgs,
  printSyncDoctorUsage,
  runSyncDoctor,
} from "./syncDoctor.js";

function printUsage(): void {
  console.log(printSyncDoctorUsage());
}

const [, , command, subcommand] = process.argv;
const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));

if (command === "auth" && subcommand === "reset") {
  const config = loadRuntimeConfig(projectRoot);
  const { password } = resetLanPassword(config);
  console.log("codex_web LAN password reset.");
  console.log(`New LAN password: ${password}`);
  console.log("Existing LAN sessions were revoked.");
  process.exit(0);
}

if (command === "sync" && subcommand === "doctor") {
  const parsed = parseSyncDoctorArgs(process.argv.slice(4));
  if (parsed.kind === "help") {
    printUsage();
    process.exit(0);
  }
  if (parsed.kind === "error") {
    console.error(parsed.error);
    printUsage();
    process.exit(1);
  }

  const result = await runSyncDoctor(parsed.options);
  if (parsed.options.reportPath) {
    const reportPath = isAbsolute(parsed.options.reportPath)
      ? parsed.options.reportPath
      : resolve(projectRoot, parsed.options.reportPath);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(
      reportPath,
      `${JSON.stringify({ result: buildSyncDoctorReport(result) }, null, 2)}\n`,
      "utf8",
    );
  }
  if (parsed.options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatSyncDoctorResult(result));
  }
  process.exit(result.ok ? 0 : 1);
}

printUsage();
process.exit(1);
