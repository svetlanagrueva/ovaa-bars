import "@testing-library/jest-dom/vitest"
import { vi } from "vitest"

// Stub `server-only` globally — modules like lib/sales.ts import it as a
// build-time guard against accidental client bundling, but it throws at
// import time (by design). Tests run in node, so the guard is irrelevant.
vi.mock("server-only", () => ({}))
