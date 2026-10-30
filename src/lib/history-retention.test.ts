import assert from "node:assert/strict";
import test from "node:test";
import { pruneHistory } from "./history-retention.ts";

const now = Date.parse("2026-10-30T12:00:00Z");

function pick(id: number, daysAgo: number, status: string) {
  return {
    id,
    at: new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    fixture: {
      date: new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
      status,
    },
  };
}

test("prunes only finished picks older than 30 days", () => {
  const oldFinished = pick(1, 31, "FINISHED");
  const recentFinished = pick(2, 20, "FINISHED");
  const oldUnfinished = pick(3, 60, "IN_PLAY");

  assert.deepEqual(pruneHistory([oldFinished, recentFinished, oldUnfinished], now), [
    recentFinished,
    oldUnfinished,
  ]);
});

test("keeps at most 100 newest finished picks and never caps unfinished picks", () => {
  const finished = Array.from({ length: 105 }, (_, index) => pick(index, index % 29, "FINISHED"));
  const pending = Array.from({ length: 105 }, (_, index) => pick(200 + index, 0, "NS"));
  const result = pruneHistory([...finished, ...pending], now);

  assert.equal(result.filter((item) => item.fixture.status === "FINISHED").length, 100);
  assert.equal(result.filter((item) => item.fixture.status === "NS").length, 105);
});