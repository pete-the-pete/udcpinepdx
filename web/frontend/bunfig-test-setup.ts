// Test-process bootstrap for `bun test`. Wires happy-dom into globalThis
// so preact components can render in a DOM-less Node-shaped runtime, and
// the @testing-library/preact harness has a document to mount into.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof (globalThis as { document?: unknown }).document === "undefined") {
  GlobalRegistrator.register();
}

// ChefWidget uses Vite's `import.meta.glob` for sprite-sheet discovery,
// which Bun doesn't implement. Stub the whole module — no unit test in
// this suite asserts chef rendering, and HeroNumber renders fine with a
// no-op widget.
// Resolve to the absolute path so bun's module registry matches whatever
// the importer ultimately resolves to.
import path from "node:path";
import { mock } from "bun:test";
const chefWidgetAbs = path.resolve(import.meta.dir, "src/chef/ChefWidget.tsx");
mock.module(chefWidgetAbs, () => ({
  ChefWidget: () => null,
}));
