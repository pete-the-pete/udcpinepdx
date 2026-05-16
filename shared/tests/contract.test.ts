import { describe, it, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_SCHEMAS } from "../src/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");

function loadFixtures(typeLower: string, kind: "valid" | "invalid"): [string, unknown][] {
  const dir = join(FIXTURES, typeLower, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f): [string, unknown] => [f, JSON.parse(readFileSync(join(dir, f), "utf8"))]);
}

describe("contract: Zod parses fixtures", () => {
  for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
    const lower = name.toLowerCase();

    for (const [filename, payload] of loadFixtures(lower, "valid")) {
      it(`${name} accepts ${filename}`, () => {
        const result = schema.safeParse(payload);
        if (!result.success) {
          throw new Error(`unexpected rejection: ${JSON.stringify(result.error.issues, null, 2)}`);
        }
        expect(result.success).toBe(true);
      });
    }

    for (const [filename, payload] of loadFixtures(lower, "invalid")) {
      it(`${name} rejects ${filename}`, () => {
        const result = schema.safeParse(payload);
        expect(result.success).toBe(false);
      });
    }
  }
});
