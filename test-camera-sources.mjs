import assert from "node:assert/strict";
import { test } from "node:test";
import { CAMERA_HISTORY, CAMERA_SOURCES, historicalSourcesFor, sourcesFor, validateCameraSources } from "./camera-sources.mjs";

test("公開カメラ台帳は重複なく必須項目を満たす", () => {
  assert.equal(validateCameraSources(), true);
  assert.ok(CAMERA_SOURCES.length >= 6);
  assert.equal(new Set(CAMERA_SOURCES.map((source) => source.id)).size, CAMERA_SOURCES.length);
});

test("過去日時の照合に使える地点一致アーカイブだけを返す", () => {
  const chichibu = historicalSourcesFor("chichibu-unkai");
  assert.equal(chichibu.length, 1);
  assert.equal(chichibu[0].history, CAMERA_HISTORY.TIMESTAMPED_ARCHIVE);
  assert.equal(historicalSourcesFor("katase").length, 0);
  assert.equal(historicalSourcesFor("osanbashi").length, 0);
});

test("周辺カメラは補助情報として台帳に残るが地点一致とは混ぜない", () => {
  const katase = sourcesFor("katase");
  assert.ok(katase.some((source) => source.coverage === "nearby"));
  assert.ok(sourcesFor("katagai").some((source) => source.coverage === "nearby"));
  assert.ok(sourcesFor("kasai-rinkai").every((source) => source.coverage === "nearby"));
});

test("ライブのみの配信を過去の記録として扱わない", () => {
  for (const source of CAMERA_SOURCES.filter((source) => source.history === CAMERA_HISTORY.LIVE_ONLY)) {
    assert.notEqual(source.history, CAMERA_HISTORY.TIMESTAMPED_ARCHIVE);
  }
});
