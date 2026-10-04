// Print the model catalogue, generated from the installed KiCad libraries.
// Usage: npx tsx scripts/catalogue.ts
import { catalogueText, missingIds } from "../lib/engine";
import { symbolLibrary } from "../lib/runs";

const lib = symbolLibrary();
const missing = missingIds(lib);
if (missing.length) {
  console.error(`Missing from the installed libraries: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(catalogueText(lib));
