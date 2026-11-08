import assert from "node:assert/strict";
import test from "node:test";
import { sameTeam } from "./team-match.ts";

test("matches the same team ignoring case and accents", () => {
  assert.ok(sameTeam("Atlético de Madrid", "atletico de madrid"));
  assert.ok(sameTeam("Real Betis Balompié", "Real Betis Balompié"));
});

test("does not mix different teams that share the last word", () => {
  assert.equal(sameTeam("Real Madrid CF", "Rayo Vallecano de Madrid"), false);
  assert.equal(sameTeam("Club Atlético de Madrid", "Rayo Vallecano de Madrid"), false);
  assert.equal(sameTeam("Valencia CF", "Elche CF"), false);
  assert.equal(sameTeam("Manchester City FC", "Manchester United FC"), false);
});

test("empty names never match", () => {
  assert.equal(sameTeam(undefined, "Elche CF"), false);
  assert.equal(sameTeam("", ""), false);
});
