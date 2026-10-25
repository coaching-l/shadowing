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

## 初回の公開結果

2026-10-25に試験公開を完了しました。

- URL: https://tools.coaching-l.net/shadowing/
- アプリソース: `6fe65bef55e25dcfcd99e142e4523dbc0676b5a7`
- 配信コミット: `4c026e2b1ed84b941d217a4218b85ad69f271804`（gh-pages）
- GitHub Pages実行: https://github.com/coaching-l/shadowing/actions/runs/40162417573 （成功）
- 公開HTML・JS・CSS・ライセンス・ソースZIPのHTTP 200を確認。JSとCSSはローカルの最終ビルドとSHA-256が一致。
- 公開URLの実Chromiumで、中国語の試聴、2文生成、再生位置の進行、文間2秒のMP3保存、教材保存を確認。MP3は外部ffprobeで7.536秒・MP3形式と確認。

追加CA登録の試行は自動審査で拒否されたため実行していません。証明書・信頼ストアを変更しない検証だけを、既存の正規信頼設定とTLS検証有効のまま実施しました。

Pagesはgh-pagesの初回pushで自動的に配信を開始したため、GitHub APIで設定を変更する必要はありませんでした。GitHubの管理APIはこの環境から接続拒否となりましたが、Gitによる公開と公開サイトの確認は完了しています。
