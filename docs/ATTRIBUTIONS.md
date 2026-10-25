# デザインと依存ライセンス

## COACHING-L

ユーザー指定 https://tools.coaching-l.net/audio-loop-player/ は環境のプロキシから403となりました。対応する https://github.com/coaching-l/audio-loop-player をHTTPS Gitの読み取りで取得し、コミット `dbebd4f669dc3bc23d0e3e886912544c4e1c29f9` の `DESIGN.md`、`style.css`、`index.html`、`icons/logo-144.png` を確認しました。公開サイトとの内容一致は未確認です。参照リポジトリは変更していません。

`public/cl-logo.png` はそのロゴをそのまま複製したものです。推測による描き直し・生成はしていません。指定された元のファイル名の画像は別途未提供ですが、参照アプリの同梱ロゴを使用しています。ロゴ・COACHING-Lのブランド権利は各権利者に帰属します。

背景 `#f7f8fa`、紺 `#042143`、金 `#c09e5c`、フォントスタック、52pxロゴと文字のヘッダー、カード角丸10px、操作角丸8px、金の見出し線、OS連動のダーク配色を再利用しました。PCの資料編集のため幅を広げた2列配置とし、狭い画面は1列です。アイコンはlucide-reactです。

## 主な依存

- React / Vite / fflate / Lucide: MIT、TypeScript: Apache-2.0。
- Kokoro JS / Transformers.js / PDF.js: Apache-2.0。
- Kokoroモデル: 上流READMEによるApache-2.0。取得できていないモデルカード・各配布ファイルの通知は実取得時の再確認対象です。
- Mammoth: BSD-2-Clause、idb: ISC。
- `@breezystack/lamejs@1.2.7`: LGPL-3.0。MP3エンコーダーは別Workerのモジュールとして使用し、変更していません。ライセンス本文を `public/licenses/lamejs-LGPL-3.0.txt` に同梱。配布元・ソース: https://github.com/shijinyu/lamejs 、正確なパッケージ: https://registry.npmjs.org/@breezystack/lamejs/-/lamejs-1.2.7.tgz 。本アプリは依存を分離してnpmから再ビルドできます。
- phonemizer: パッケージ表記はApache-2.0。内部のeSpeak NG由来コンポーネントにはGPL系の通知もあるため、配信版にはApache-2.0とGPL-3.0の通知、パッケージのライセンス、上流の音素化コード・eSpeak NGソースへの参照を含めます。音素化に使用し、eSpeakの合成音声を本アプリの声として提供しません。出典: https://github.com/xenova/phonemizer.js 、https://github.com/espeak-ng/espeak-ng 。

ライセンス文は各npmパッケージ内のLICENSEも参照してください。ユーザーの許可に基づき、試験公開用の配信ファイルを準備しました。公開版のフッターからライセンス一覧・ソースを参照できます。録音・教材・音声の権利はユーザー側で確認してください。

## 中国語実装の追加依存

pinyin-pro 3.29.5はMITライセンス（https://github.com/zh-lx/pinyin-pro）。音素の対応表はMisakiのZHFrontendから適応し、元のApache-2.0通知とPaddlePaddleの著作権表示をソースに保持しています。対応ライセンス本文をpublic/licensesに同梱しています。Pythonサーバーをアプリの必須構成にはしていません。
