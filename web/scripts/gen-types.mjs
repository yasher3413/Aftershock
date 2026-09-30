// Generate TypeScript types from the pydantic JSON Schema.
// Usage: pnpm types (after `aftershock export-schema web/src/api/schema.json`).
import { readFileSync, writeFileSync } from "node:fs";
import { compile } from "json-schema-to-typescript";

const schema = JSON.parse(readFileSync("src/api/schema.json", "utf8"));

// Keep titles only on named definitions so fields inline instead of
// producing one alias type per property.
function stripTitles(node, keep) {
  if (Array.isArray(node)) return node.forEach((n) => stripTitles(n, false));
  if (!node || typeof node !== "object") return;
  if (!keep) delete node.title;
  for (const [key, value] of Object.entries(node)) {
    if (key === "$defs") {
      for (const def of Object.values(value)) stripTitles(def, true);
    } else {
      stripTitles(value, false);
    }
  }
}
stripTitles(schema, true);
const ts = await compile(schema, "Schema", {
  bannerComment:
    "/* Generated from services/aftershock/api/schemas.py. Do not edit; run `make types`. */",
  additionalProperties: false,
  unreachableDefinitions: true,
  style: { printWidth: 100 },
});
writeFileSync("src/api/types.gen.ts", ts);
console.log("wrote src/api/types.gen.ts");
