import { currentLegacyBuild, hashBuild, writeBaseline } from "./legacy-baseline.ts";

/** Records the current legacy output as the regression baseline. */
const files = hashBuild(currentLegacyBuild());
writeBaseline(files);
console.log(`legacy baseline updated (${Object.keys(files).length} files)`);
