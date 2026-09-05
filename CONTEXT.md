# CONTEXT — nback-voice

セッションをまたいで「このアプリがどう動くか」を思い出すための1枚。
新しい会話や別マシンで作業を始めるとき、まずこれを読む。
手順書は [docs/RUNBOOK.md](docs/RUNBOOK.md)、設計の経緯は `docs/superpowers/specs/` にある。ここは重複させず、**全体像・判断・落とし穴**だけを置く。

---

## これは何のアプリか

音声デュアル N-back の学習アプリ。Expo (React Native) + react-native-web。
グリッド位置と読み上げ音声の2ストリームを N 手前と照合させ、金融の一問一答
(series) を挟む。iOS 実機 / Web の両方に出す。

- **フロント**: Expo SDK、`App.tsx` が画面ステートマシン（series → game → results / settings / questions）。
- **音声**: `expo-speech`（発話）、`expo-speech-recognition`（聞き取り）、タイプ入力モードは `src/speech/typed.ts`。
- **課金**: `expo-iap`（`src/store/iap.ts`）。ティア制限は `src/store/` 周辺。
- **採点**: ローカル判定 `src/judge/local.ts` と Claude 判定 `src/judge/claude.ts`、`src/judge/queue.ts` がオフライン劣化を吸収。

## ディレクトリの地図（どこに何があるか）

| 場所 | 役割 |
|------|------|
| `App.tsx` | 画面遷移のルート。ステートマシン。 |
| `src/engine/` | ゲームのルール・採点・ラウンド進行・適応難易度・予算。純ロジック、テスト厚い。 |
| `src/content/` | 一問一答の本体。`series.json`（日本語）/ `series.en.json`（英語）が正。`review.ts`/`translate.ts` はビルド時harness。 |
| `src/judge/` | 回答判定。local と claude、queue でオフライン耐性。 |
| `src/speech/` | 発話・聞き取り・タイプ入力・ロケール。`fakes.ts` はテスト用の即解決TTS。 |
| `src/store/` | 永続化（AsyncStorage）と課金（IAP）。 |
| `src/strings/` | UI文言。多言語。 |
| `src/ui/` | 画面コンポーネント一式 + `theme.ts`。 |
| `src/shims/` | `metroNodeStub.js` — native で `node:` import を空に差し替える（下記の落とし穴）。 |

## ビルド・確認の3段（実機なしで進む範囲）

RUNBOOK に詳細。要点だけ:

1. `npm test`（24 suites / 354 tests）+ `npx tsc --noEmit` — ルール/採点/2相ステップまで実機なしで回る。**ただしTTSはフェイクで即解決なので、発話の実時間が絡むバグはここに出ない。**
2. `npm run check:bundle` — iOS と Web を両方 export。**テストも型も通るのに iOS バンドルだけ落ちる**壊れ方が実在する。依存追加・SDK 上げのたびに必ず1回。
3. `expo start --web` でブラウザ確認。

## デプロイ

- Web は Cloudflare Pages に2プロジェクト（**本番アプリ**と**デモ**）。`npm run deploy:realapp` / `deploy:demo` / `deploy:web`（両方）。スクリプトは `scripts/deploy-web.sh`。
- iPhone 実機は EAS（`eas.json`）。プロジェクトはリンク済み。`eas device:create` は実ターミナルで手動。
- **GitHub push はデプロイを起こさない**（Cloudflare とは別系統）。

## 落とし穴（過去に踏んだ・繰り返しやすい）

1. **iOS バンドルだけ落ちる**: `@anthropic-ai/sdk` の `client.mjs` が `node:fs` を引き込む。RN に Node 組み込みは無い。Metro は到達しないコードも解決するので、一度も通らないパスでバンドルが止まる。`metro.config.js` が native のときだけ `node:` import を空モジュールに差し替えて塞ぐ（web は素通し）。**依存を足したら check:bundle。**
2. **TTS フェイクの穴**: 全テストが緑でも、発話の実時間が絡む重大バグは1件すり抜けた実績あり。音声まわりの変更は実機/ブラウザで必ず目視。
3. **WSL の Google Drive マウント**: `/mnt/c/Projects/book/Books` は `/mnt/g/マイドライブ/Books`（Drive）への symlink。読めないのは「未マウント」ではなく **Drive のオンデマンド配信が冷える**のが原因で、症状は `No such device`（`No such file` ではない）。恒久対策は Windows 側でフォルダを「オフラインで使用可能」にピン留め。強制再マウントは `sudo umount /mnt/g; sudo mount /mnt/g`（`/etc/sudoers.d/gdrive-mount` で NOPASSWD 済み）。日本語ドライブなので `My Drive` ではなく `マイドライブ`。詳細は Claude memory の gdrive-mount-stale。
4. **WSL の npm rename race**: `/mnt/c` 上の `npm install` が ENOTEMPTY で無限ループしうる。tsc + node で回避。
5. **series の品質**: 問題は静的な `series.json`。品質は実行時生成でなく `npm run review-questions`（Claude 監査harness）で担保。

## いま進行中 / 未了

（更新する場所。今の既知の残り: テーマ改題、書籍リファラルUI、音声バグ、全問再監査 — 詳細は Claude memory の content-feedback を参照）
