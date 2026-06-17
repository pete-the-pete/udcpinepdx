// Test-process bootstrap for `bun test`. Wires happy-dom into globalThis
// so preact components can render in a DOM-less Node-shaped runtime, and
// the @testing-library/preact harness has a document to mount into.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof (globalThis as { document?: unknown }).document === "undefined") {
  GlobalRegistrator.register();
}

// ChefStage and ChefWidget use Vite's `import.meta.glob` for sprite-sheet
// discovery, which Bun doesn't implement. Stub it on import.meta globally
// so ChefStage can load (and be tested directly), then stub ChefWidget for
// tests that render the full app where sprite rendering is irrelevant.

// ChefStage and ChefWidget use Vite's `import.meta.glob` for sprite-sheet
// discovery, which Bun doesn't implement. Stub the sheet-urls module (the
// extracted glob wrapper) and stub ChefWidget for tests that render the full
// app where sprite rendering is irrelevant.
import path from "node:path";
import { mock } from "bun:test";

const sheetUrlsAbs = path.resolve(import.meta.dir, "src/chef/sheet-urls.ts");
mock.module(sheetUrlsAbs, () => ({ sheetUrls: {} }));

const chefWidgetAbs = path.resolve(import.meta.dir, "src/chef/ChefWidget.tsx");
mock.module(chefWidgetAbs, () => ({
  ChefWidget: () => null,
}));
