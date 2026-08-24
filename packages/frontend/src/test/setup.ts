import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library does not auto-clean when `globals: false`, so unmount between
// tests: a leaked tree would let one test's DOM satisfy the next one's query.
afterEach(() => {
  cleanup();
});
