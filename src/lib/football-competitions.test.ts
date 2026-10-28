import assert from "node:assert/strict";
import test from "node:test";
import { TRACKED_COMPETITIONS, TRACKED_COMPETITION_IDS } from "./football-competitions.ts";

test("tracks requested domestic cups, Spanish second division, and UEFA competitions", () => {
  const expectedIds = [45, 48, 141, 143, 3, 531];
  for (const id of expectedIds) assert.ok(TRACKED_COMPETITION_IDS.has(id));
});

test("competition IDs are unique", () => {
  assert.equal(TRACKED_COMPETITION_IDS.size, TRACKED_COMPETITIONS.length);
});