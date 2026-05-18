import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, "..", "logs");

export function initLog(filename) {
  if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
  const lines = [];

  const log = (msg = "") => {
    console.log(msg);
    lines.push(msg);
  };

  const save = () => {
    writeFileSync(join(LOGS_DIR, filename), lines.join("\n") + "\n");
    console.log(`\nLog saved → logs/${filename}`);
  };

  return { log, save };
}

export function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  return `  PASS: ${message}`;
}

export function eth(wei) {
  return `${(Number(wei) / 1e18).toFixed(4)} ETH`;
}
