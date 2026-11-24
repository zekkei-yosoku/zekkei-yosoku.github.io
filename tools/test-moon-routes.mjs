import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL("../experiments/moon-map/astronotes-routes.js", import.meta.url), "utf8"), context);
const { operationFor, operationStatus } = context.AstroNotesRoutes;
const at = (time) => `2026-11-24T${time}+09:00`;

test("deep-night routes never reuse the daytime model, including midnight", () => {
  for (const time of ["00:00:00", "05:59:59", "23:00:00", "23:59:59"]) {
    const status = operationStatus(at(time));
    assert.equal(status.supported, false, time);
    assert.equal(status.period, "night", time);
    assert.equal(status.northWindow, null);
    assert.equal(status.southWindow, null);
  }
  assert.equal(operationStatus(at("06:00:00")).supported, true);
  assert.equal(operationStatus(at("22:59:59")).supported, true);
});

test("published north and south time windows have exact half-hour boundaries", () => {
  const cases = [
    ["06:59:59", "existing", "existing"], ["07:00:00", "new", "existing"],
    ["11:29:59", "new", "existing"], ["11:30:00", "existing", "existing"],
    ["14:59:59", "existing", "existing"], ["15:00:00", "new", "new"],
    ["18:59:59", "new", "new"], ["19:00:00", "existing", "existing"],
  ];
  for (const [time, north, south] of cases) {
    const status = operationStatus(at(time));
    assert.equal(status.northWindow, north, time);
    assert.equal(status.southWindow, south, time);
    assert.equal(status.operationConfirmed, false);
  }
});

test("JST is derived from the instant, including Date objects from other realms", () => {
  const input = "2026-11-24T06:00:00Z";
  for (const value of [input, Date.parse(input), new Date(input), "2026-11-24T01:00:00-05:00"]) {
    const status = operationStatus(value);
    assert.equal(status.hourJst, 15);
    assert.equal(status.timeZone, "Asia/Tokyo");
    assert.equal(status.southWindow, "new");
  }
});

test("missing, invalid, or timezone-ambiguous time stays unsupported", () => {
  for (const value of [undefined, null, "", "invalid", "2026-11-24T15:00", NaN, Infinity, new Date(NaN), {}]) {
    const status = operationStatus(value);
    assert.equal(status.supported, false, String(value));
    assert.equal(status.period, "unknown");
    assert.equal(status.hourJst, null);
  }
});

test("bad or missing wind cannot silently select north or south", () => {
  for (const direction of [null, undefined, NaN, Infinity, "180", -1, 361]) assert.equal(operationFor(direction, 5, 16), null);
  for (const speed of [null, NaN, Infinity, "5", -0.1]) assert.equal(operationFor(150, speed, 16), null);
  for (const hour of [null, NaN, Infinity, "16", -1, 24]) assert.equal(operationFor(150, 5, hour), null);
});

test("existing wind-model choices remain estimates and keep optional-argument behavior", () => {
  assert.equal(operationFor(330, 5, 16), "north");
  assert.equal(operationFor(360, 5, 16), "north");
  assert.equal(operationFor(150, 5, 14.99), "southBay");
  assert.equal(operationFor(150, 5, 15), "south");
  assert.equal(operationFor(150, 5, 19), "southBay");
  assert.equal(operationFor(150), "south");
  assert.equal(operationFor(150, 0, 16), "north");
  assert.equal(operationFor(150, 2.6, 16), "north");
  assert.equal(operationFor(150, 2.61, 16), "south");
});
