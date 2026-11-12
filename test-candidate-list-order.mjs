import {createRequire} from 'node:module';
// tools/candidate-picker.test.cjs（候補一覧の種類・並び・まとめ方）をテスト一覧（test-*.mjs）から実行する。
createRequire(import.meta.url)('./tools/candidate-picker.test.cjs');
