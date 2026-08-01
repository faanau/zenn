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

### ペース

**1〜2週間に1本。** まとめて出さない。

12本のストックを一度に放出すると、明らかに在庫を吐いているように見える。
継続的に書いている人に見える方が、フォローも被リンクも付く。

投稿は平日の朝（9〜10時 JST）が読まれやすい。

### 公開順

足場を作ってから強い記事を出す。何も無いアカウントで長文を出しても読まれない。

1. `zod-silently-drops-undeclared-fields` — 短く汎用的。最初の1本は読み切れる長さが良い
2. `gsc-url-inspection-api-audit` — 実用価値が高く、スクリプトが持ち帰れる
3. `oss-kuromoji-revival` — 読み物として最強。上2本で実績を作ってから
4. `ai-content-bottleneck-is-verification` — AI活用は関心が高い。ただし
   **1〜3で技術的な信用を作ってから**出す。いきなりAIの話から入ると、
   よくある「AIで効率化しました」記事に埋もれる
5. `npm-trusted-publishing-pitfalls` — 情報が少ない領域
6. `ai-agent-adopting-abandoned-oss` — 失敗を並べる記事なので、
   実績（1〜3）が見えている状態で出す方が説得力がある
7. 以降は反応を見て決める

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

## 公開前チェック

下書きには判断が要る箇所がある。**公開前に必ず目を通すこと。**

- **上流プロジェクトへの言及** — kuromoji / kuroshiro の記事は他人のOSSを「放置されている」と
  書いている。事実だが当事者が読む可能性がある
- **AI生成の開示** — AI関連の2本は、jpn.fan の記事がAI下書きであることを
  前提に書いている。これは**公開判断そのもの**なので、必ず確認すること。
  `ai-content-bottleneck-is-verification` は開示の是非に踏み込まず
  「開示に耐える作り方をしているか」に寄せてあるが、記事を出すこと自体が
  一定の開示になる
- **法人番号の露出** — `entity-linkage-corporate-number` に記載。公開情報だが意図した露出か
- **自社の運用ミス** — `two-repos-one-bucket-incidents` は3件書いている。技術記事としては
  誠実さが強みだが、取引先が読む可能性も考える

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
