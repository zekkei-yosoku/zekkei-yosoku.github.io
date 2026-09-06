import assert from "node:assert/strict";
import test from "node:test";
import { parseCloudviewPage } from "./study-cloudview.mjs";

test("公式カメラの日時と画像URLを台帳へ取り込む", () => {
  const html = `
    <button class="thumb-item" data-full="/photos/a.jpg" data-caption="2026/09/05 06:04">
      <img alt="秩父雲海カメラ 2026/09/05 06:04">
    </button>
    <button class="thumb-item" data-full="/photos/a.jpg" data-caption="2026/09/05 06:04">
      <img alt="重複">
    </button>
    <button class="thumb-item" data-full="/photos/b.jpg" data-caption="2026/09/04 06:03">
      <img alt="秩父雲海カメラ 2026/09/04 06:03">
    </button>
    <button class="thumb-item" data-full="/cloudview/best/old.jpg" data-caption="2025/12/25 09:40">
      <img alt="ベストショット">
    </button>`;
  assert.deepEqual(parseCloudviewPage(html), [
    {
      date: "2026-09-04", cameraTime: "2026/09/04 06:03", phenomenon: "seaOfClouds",
      status: "unreviewed", observedQuality: null,
      source: "https://navi.city.chichibu.lg.jp/cloudview",
      imageUrl: "https://navi.city.chichibu.lg.jp/photos/b.jpg",
    },
    {
      date: "2026-09-05", cameraTime: "2026/09/05 06:04", phenomenon: "seaOfClouds",
      status: "unreviewed", observedQuality: null,
      source: "https://navi.city.chichibu.lg.jp/cloudview",
      imageUrl: "https://navi.city.chichibu.lg.jp/photos/a.jpg",
    },
  ]);
});

test("画像未確認は陰性にならない", () => {
  const [row] = parseCloudviewPage(
    '<button data-full="/photos/a.jpg" data-caption="2026/09/05 06:04"></button>',
  );
  assert.equal(row.status, "unreviewed");
  assert.equal(row.observedQuality, null);
});
