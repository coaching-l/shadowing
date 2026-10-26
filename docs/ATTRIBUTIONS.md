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

## タイポ確認・録音フィードバック

- nspell 2.1.5はMIT、dictionary-en 4.0.0はMIT/BSD表記。SCOWL・WordNet等を含む辞書配布物の通知を、生成される`licenses/dependencies/dictionary-en/license`に保持します。辞書データは変更していません。
- MacBERT: https://huggingface.co/Xenova/macbert4csc-base-chinese 、上流 https://huggingface.co/shibing624/macbert4csc-base-chinese （Apache-2.0）。
- Whisper tiny: https://huggingface.co/Xenova/whisper-tiny （Apache-2.0表記）、上流 https://github.com/openai/whisper （MIT、Copyright (c) 2022 OpenAI）。MIT本文を同梱。
- OpenCC.js 1.4.2はMIT、組込み辞書データはApache-2.0。root LICENSEに加え、同梱THIRD_PARTY_LICENSES.mdとLICENSESディレクトリも配信物へ複製します。

モデルの固定revision・容量・実行方式と制約はLOCAL-AI.mdに記載しています。この追加により既存のGPL/LGPL部品を含むアプリ全体の配布適合性まで確認済みとなるものではありません。

## 文脈校正の追加依存

- 英語の原モデル `visheratin/t5-efficient-mini-grammar-correction` はモデルカードにMIT表記。作者はAlexander Visheratin。使用するONNX INT8変換版はTonyRajuによる `visheratin-t5-mini-grammar-correction-onnx-int8`、固定revisionと3つのファイルのSHA-256をコードに保持しています。重みは改変せず取得し、作者・変換元・変換版への参照とMIT本文を`public/licenses/english-gec-model-MIT.txt`に同梱します。基礎となるGoogle T5のApache-2.0本文も維持します。
- dictionary-en-gb 3.0.0はMIT/BSD表記。辞書の全通知を配布パッケージのlicenseファイルから保持します。米国・英国の両辞書を検査に使い、綴りの地域差だけの変更を抑えます。
- diff 8.0.2はBSD-3-Clause（パッケージLICENSEを配信物へ複製）、ONNX Runtime WebはMIT。直接依存に固定して使用します。
- 非商用条件のあるvennify、CoEdITのモデルは採用していません。この追加で既存のGPL/LGPLを含む配布条件全体が解決したという意味ではありません。
