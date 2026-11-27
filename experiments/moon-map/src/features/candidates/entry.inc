// Pass candidate data as bytes so reloads do not leave WebKit reading a document-owned Blob.
function decompressCandidateBytes(bytes, format = 'gzip') {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let offset = 0;
  const source = new ReadableStream({
    pull(controller) {
      const end = Math.min(offset + 65536, data.byteLength);
      if (end > offset) controller.enqueue(data.subarray(offset, end));
      offset = end;
      if (offset === data.byteLength) controller.close();
    }
  });
  return new Response(source.pipeThrough(new DecompressionStream(format)));
}
@@include:src/features/candidates/building-model.js@@
@@include:src/features/candidates/height-grid.js@@
@@include:src/features/candidates/tree-heights.js@@
@@include:src/features/candidates/visibility-map.js@@
@@include:src/features/candidates/plateau-buildings.js@@
@@include:src/features/candidates/osm-places.js@@
@@include:src/features/candidates/terrain-model.js@@
@@include:src/features/candidates/live-terrain.js@@
@@include:src/features/candidates/scene-surface.js@@
@@include:src/features/candidates/composition.js@@
@@include:src/features/candidates/model-evaluator.js@@
@@include:src/features/candidates/tower-quality.js@@
@@include:src/features/candidates/search.js@@
@@include:src/features/candidates/place-provider.js@@
@@include:src/features/candidates/generic-evaluator.js@@
@@include:src/features/candidates/generic-search.js@@
@@include:src/features/candidates/composition-ui.js@@
@@include:src/features/candidates/place-labels.js@@
@@include:src/features/candidates/candidate-picker.js@@
@@include:src/features/candidates/ui.js@@
@@include:src/features/candidates/overlap-scope.js@@
@@include:src/features/candidates/error-log.js@@
