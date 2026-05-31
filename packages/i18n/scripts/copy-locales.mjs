import { cpSync, existsSync } from "node:fs";

const source = new URL("../src/locales", import.meta.url);
const target = new URL("../dist/locales", import.meta.url);

if (existsSync(source)) {
  cpSync(source, target, { recursive: true });
}
