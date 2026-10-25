# GitHub Pagesでの試験公開

ユーザーが2026-10-25に試験公開を許可しました。既存のCOACHING-Lサイトと同じGitHub Pagesを使用し、課金契約や外部アカウントは追加しません。

## 作成コマンド

```sh
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci
npm test
npm run build
node scripts/prepare-pages.mjs
```

`dist` は公開用の静的ファイルです。`.nojekyll`、各依存のライセンス、アプリソースのZIPも含みます。資料・生成音声・録音・音声モデル本体は含みません。モデルは利用者の端末が初回に公開配布元から取得します。

## Pagesの設定

`coaching-l/shadowing` のGitHub Settings → Pagesで、SourceをDeploy from a branch、Branchを`gh-pages`、フォルダーを`/(root)`に設定します。リポジトリ固有のカスタムドメインは設定しません。組織サイトのドメインが継承される場合の公開先は https://tools.coaching-l.net/shadowing/ です。URLのHTTP応答と内容を確認するまで公開完了とは扱いません。

ソースは`main`、配信ファイルは`gh-pages`で管理します。配信更新時は毎回ビルドとprepare-pagesを実行します。`.validation-audio`や資料・録音は公開ブランチに含めません。

## 試験版の制約

中国語は試験対応です。普通話の多音字・声調・自然さの聴取評価、スマートフォン実機は未確認です。初回の重み取得は英語約92 MB、中国語約339 MBに実行ファイル等が加わります。試験版の表示と制約をアプリ内に残します。
