import assert from "node:assert/strict";
import test from "node:test";
import { TRACKED_COMPETITIONS, TRACKED_COMPETITION_IDS } from "./football-competitions.ts";

test("keeps only the six supported original competitions", () => {
  assert.deepEqual(
    TRACKED_COMPETITIONS.map(({ id }) => id),
    [39, 140, 135, 78, 61, 2],
  );
});

test("competition IDs are unique", () => {
  assert.equal(TRACKED_COMPETITION_IDS.size, TRACKED_COMPETITIONS.length);
});