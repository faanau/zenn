# Zenn articles — Faanau, inc.

[Zenn](https://zenn.dev/) の GitHub 連携用リポジトリ。`articles/*.md` がそのまま記事になる。

## 運用

### 公開の仕方

frontmatter の `published` を `true` にして push すると公開される。
`false` のままなら、push しても下書きのまま（Zenn 上でプレビューできる）。

```yaml
---
title: "..."
emoji: "🔎"
type: "tech"      # tech | idea
topics: ["seo", "astro"]   # 最大5つ
published: false  # ← true にすると公開
---
```

### 自動公開

`publish-queue.txt` に書いた slug が、**上から順に自動で公開される**。

```
.github/workflows/publish-next.yml   毎週火曜 09:00 JST に起動
scripts/publish-next.mjs             10日以上空いていれば1本出す
publish-queue.txt                    出してよい記事のリスト = 承認の記録
```

**キューに書いていない記事は絶対に公開されない。** `published: false` のまま残る。
これが下書きと公開の間に立っている唯一のものなので、ここを緩めないこと。

記事を追加する手順:

1. 記事を読む
2. 下の「公開前チェック」3項目に該当しないか確認する
3. `publish-queue.txt` に1行足して push

間隔は cron ではなくスクリプト側で判定している。GitHub の cron は「隔週」を
書けないうえ、週次 + 経過日数判定なら実行が1回飛んでも間隔が狂わない。
経過日数は git log の `publish: ` コミットから読むので、手動公開も勘定に入る。

手動で試すとき:

```
gh workflow run publish-next.yml -f dry-run=true    # 何が起きるか見るだけ
gh workflow run publish-next.yml -f dry-run=false   # 待機期間を尊重して公開
gh workflow run publish-next.yml -f dry-run=false -f force=true   # 即座に
gh workflow run publish-next.yml -f notify-test=true # メール送信だけ試す
```

### 通知

**記事が出たとき**と**壊れたとき**にメールが飛ぶ。待機期間中で何もしない週は
無言。それが大半なので、毎週「何もありませんでした」を送ると読まれなくなり、
肝心の1通も一緒に読まれなくなる。

```
scripts/notify.mjs   本文を組み立てて SES で送る
```

送信は GitHub OIDC → IAM ロール → SES。**AWS の鍵はこのリポジトリに無い**
（npm 公開と同じ方式）。リポジトリが public なので、宛先とロール ARN も
リポジトリ Secrets に置いてある。

| | |
|---|---|
| `NOTIFY_EMAIL_TO` | 宛先 |
| `AWS_NOTIFY_ROLE_ARN` | `zenn-publish-notifier`。信頼するのは `repo:faanau/zenn:*` のみ、権限は `ses:SendEmail` のみ、送信元も `noreply@faanau.co.jp` に固定 |

**送信に失敗したらワークフローごと赤くしている。** 握りつぶすと、通知が届かない
ことに気づく手段が無くなる。赤くしておけば GitHub 標準の「ワークフローが
失敗しました」メールが最後の砦になる。

失敗メールは、公開処理まで進んでいたかどうかで文面が変わる。commit と push の
どちらで落ちたかで公開済みか未公開かが変わるので、そこを断定せずに確認手順を
書いてある。どちらにせよ**二重に公開されることはない**（キューは公開済みを
飛ばすため）。

### ペース

**1〜2週間に1本。** まとめて出さない。

12本のストックを一度に放出すると、明らかに在庫を吐いているように見える。
継続的に書いている人に見える方が、フォローも被リンクも付く。

投稿は平日の朝（9〜10時 JST）が読まれやすい。

### 公開順

`publish-queue.txt` がその記録。順序の考え方もそこに書いてある。

```
 ✓ zod-silently-drops-undeclared-fields   2026-08-02 公開済み
 1 gsc-url-inspection-api-audit
 2 oss-kuromoji-revival
 3 ai-content-bottleneck-is-verification
 4 npm-trusted-publishing-pitfalls
 5 two-repos-one-bucket-incidents
 6 ai-agent-adopting-abandoned-oss
 7 when-to-change-urls-subdomain-consolidation
 8 verify-dont-generate-furigana
 9 thin-page-gate-noindex-not-404
10 keyword-cannibalisation-detector
11 cloudfront-function-10kb-limit
12 seo-title-vs-editorial-headline
13 entity-linkage-corporate-number
```

10日間隔で約4か月半ぶん。手を入れなくても流れ続ける。

## なぜ書くか

[jpn.fan](https://jpn.fan) の被リンク獲得策。ただし**宣伝記事ではない**。

技術者は「二次リンクを生む唯一の層」で、記事を読んで実際に使い、自分のブログで書く。
そこで生まれるのは編集リンクで、企業ディレクトリからのリンクとは価値が違う。

そのために守っている条件:

- **発見の話であること。** 「作りました」ではなく「調べたらこうだった」
- **数字は実測。** 記憶から書かない
- **一般化できること。** その場限りの話は読まれない
- **jpn.fan への言及は末尾に1回だけ**、文脈がある場合のみ
- **自分の失敗を隠さない。** 隠した瞬間に宣伝臭くなる

## 公開前チェック（2026-08-02 全件承認済み）

14本すべて通読のうえ、以下3点は「そのまま出す」と判断済み。
**新しい記事を書いたときは、同じ3点を見てからキューに足すこと。**

- **上流プロジェクトへの言及** — `oss-kuromoji-revival` が実質唯一。
  批判ではなく分析として書けており、「解析器そのものは健在」「腐っていたのは
  周辺だけ」は本体設計への評価になっている。上流にPRを出したこと、
  パッケージ名を乗っ取っていないことも本文に明記してある
- **法人番号** — `entity-linkage-corporate-number` の JSON-LD 実例に実物を掲載。
  国税庁の公表情報であり、既に jpn.fan と faanau.co.jp 双方の構造化データに
  出ている。ダミーに替えると「実際にこう運用している」が伝わらない
- **自社の運用ミス** — 5本にまたがる。この種の記事は失敗を隠した瞬間に
  宣伝になるので、誠実さを取る。内容は新規サイト立ち上げで踏んだ罠であって、
  受託案件の話ではない
- ~~**AI生成の開示**~~ — 解決済み。jpn.fan が既に記事ページで開示している:

  > AI then wrote up the analysis from those source quotes — every Japanese /
  > English excerpt above is a byte-exact capture from the cited manga
  > editions, not invented.
  >
  > Written up by Aine (愛音), the AI persona ... The picks, the cultural
  > readings, and the final review are by Faanau, inc.

## 転載

Zenn で公開した2〜4週間後に faanau.co.jp へ転載し、`canonical` を Zenn に向ける。

順序が逆（自社が先）だと誰も読まないまま埋もれる。読者がいる場所に先に出し、
落ち着いてから自社ドメインにも資産を積む。

## ローカルでプレビュー

```
npm install
npx zenn preview
```

## 記事一覧

| slug | 主題 |
|---|---|
| `zod-silently-drops-undeclared-fields` | Zodが未宣言フィールドを黙って捨て、機能が8ヶ月無効だった |
| `gsc-url-inspection-api-audit` | GSCの画面では分からない「どのURLが未登録か」をAPIで全数調査する |
| `oss-kuromoji-revival` | 週35万DLのnpmパッケージが8年放置された理由はIssueではなくテストだった |
| `npm-trusted-publishing-pitfalls` | npm Trusted Publishing に辿り着くまでに踏んだ地雷を全部書く |
| `cloudfront-function-10kb-limit` | CloudFront Functionの10KB制限にコメントで引っかかる |
| `verify-dont-generate-furigana` | 形態素解析器は生成より検証に使う方が良かった |
| `two-repos-one-bucket-incidents` | 1つのS3バケットを2リポジトリで共有して起きた3つの事故 |
| `when-to-change-urls-subdomain-consolidation` | URLを変えるなら「Googleがまだ知らないうち」 |
| `thin-page-gate-noindex-not-404` | 薄いページは404にせずnoindexで沈める |
| `keyword-cannibalisation-detector` | 37語のスタブが2000語の記事を押さえつけていた |
| `seo-title-vs-editorial-headline` | URLスラッグの方が`<title>`より検索語を含んでいた |
| `entity-linkage-corporate-number` | 法人サイトと事業サイトが構造化データ上無関係だった |
| `ai-content-bottleneck-is-verification` | AIに書かせるときのボトルネックは生成ではなく検証だった |
| `ai-agent-adopting-abandoned-oss` | AIエージェントに8年放置のOSSを引き取らせた |
