---
title: "URLスラッグの方が<title>より検索語を含んでいた — 見出しとタイトルを分離する"
emoji: "🏷️"
type: "tech"
topics: ["seo", "コンテンツ管理", "astro"]
published: false
---

インデックスが伸びないサイトを調べていて、こう相談された。

> URLが検索語を含んでいないのが弱点では？

もっともな仮説に見えたので、実データを見た。**前提が逆だった。**

## URLスラッグは、むしろ検索語を含んでいた

```
/pitfalls/dattebayo/
/glossary/haki/
/pitfalls/shiranui/
/pitfalls/nakama-five-ways/
```

問題ない。むしろ良い方だ。

`<title>` はこうだった。

| 実際の `<title>` | 検索語 |
|---|---|
| `You See "UN-KNOWING FIRE", We See Ocean Ghosts: The True Meaning of First Form` | **ゼロ**（不知火の記事なのに "shiranui" が無い） |
| `Why VIZ's 'Rising Scorching Sun' nails the poetic punch of 昇り炎天` | **ゼロ** |
| `The Tree That Isn't There: How English Fluency Invented a Backstory for the Gum-Gum Fruit` | 弱い |
| `642 Balloons, Zero Translations: The Dattebayo Problem — Naruto Uzumaki` | あるが31文字目。SERPで切れる |
| `Giyu Tomioka — jpn.fan` | 名前だけ。あらゆるwikiと競合する |

**URLスラッグの方がタイトルより検索語を含んでいる**という逆転が起きていた。

雑誌の見出しとしては良い。書き手の力量が出ている。だが**検索結果に表示される文字列としては機能していない**。

## URLは変えないと決めた

「じゃあURLも整えよう」とはならなかった。理由は2つある。

**1. キーワードinURLは極めて弱い要因。** Google 自身が「非常に小さなランキング要因」と繰り返し言っている。効くとすれば、裸のURLがそのままアンカーテキストとして貼られたときと、SERP のパンくず表示くらいだ。

**2. 移行コストが割に合わない。** このサイトは直前にホスト統合をやったばかりで、URLを凍結した直後だった。ここでもう一度動かすのは、まさに「URL churn」で、それが今の状態を作った一因でもある。

**いちばん強い改善が、いちばん安い場所にあった。** `<title>` はページ内で最も強い要因の1つで、変更コストはゼロだ。

## 見出しを捨てずにタイトルを直す

編集的な見出しには価値がある。書き手の声であり、記事の個性でもある。それを検索向けの平板な文字列に置き換えるのは損失だ。

なので**分離した**。任意フィールドを1つ足す。

```ts
/** Search-facing <title> override. `title` is an editorial headline
 *  that reads well as an <h1> but often contains none of the terms a
 *  reader would type. When set, this replaces the <title> only — the
 *  visible headline is untouched. */
seoTitle: z.string().optional(),
```

テンプレート側は1行。

```astro
<Layout title={entry.seoTitle ?? entry.title} ...>
```

`<h1>` は常に `title` を使う。**ページを開いた読者が見るものは変わらない。**

## 書き方のルール

```
Shiranui (不知火) Meaning — Rengoku's First Form and VIZ's "Un-Knowing Fire"
Haki Meaning in One Piece — 覇気 Explained (Armament / Observation / Conqueror's)
Dattebayo Meaning — Why Naruto's Catchphrase Never Reached the English Manga
Nakama (仲間) Meaning in One Piece — the 5 Ways VIZ Translated It
```

決めた規則。

1. **打たれる語を先頭に置く。** `Shiranui (不知火) Meaning — …` であって `You See "UN-KNOWING FIRE"…` ではない
2. **日本語を括弧で入れる。** 読者は両方の表記で検索する
3. **クリックする理由になる限定詞を足す。** キャラ名、作品名、`Meaning` / `Explained`
4. **70文字以内。** SERPの切り詰めに耐える
5. Google はタイトルを高頻度で書き換える。**それでいい。** 目的は文字列を制御することではなく、主題を曖昧さなく述べること

## スタブに付けてはいけない

運用上の落とし穴が1つある。

**完成していない記事に検索向けタイトルを付けるのは、付けないより悪い。** 空のページへのクリックを誘うことになり、直帰して戻ってくる。悪い評価を積極的に取りに行く形になる。

なのでコメントに書いた。

```ts
/** Set only when the entry is FINISHED — a keyword-optimised title on a
 *  stub invites the click that proves the page is empty. */
```

チェックリストにも「完成時のみ設定」と書いた。**規則はコードとドキュメントの両方に置かないと、片方しか読まれない。**

## どこから直すか

全記事を一度に直す必要はない。**Googleが次にクロールしに来る順**でやるのが効率的だ。

このときはインデックス登録をリクエストした直後だったので、その10本を先に直した。リクエスト済みのURLはGoogleが近日中に取りに来るので、**その前にタイトルが入っていれば新しい方が評価される**。

キーワードデータがあるなら、それを使って head term を機械的に決められる。無ければ、**そのページを探している人が何と打つか**を素朴に考えれば足りる。

## ついでに見つかったこと

タイトルを見直していて、別の問題も出てきた。

```
/c/naruto/glossary/dattebayo/     37語のスタブ
/c/naruto/pitfalls/dattebayo/   2003語の完成記事
```

**同じ語を2ページで狙っていた。** タイトルを直す前に、そもそもどちらが正なのかを決める必要があった。

タイトルの見直しは、**「このページは何について書かれているか」を1行で言えるか**を全記事に対して問う作業になる。言えないページ、他のページと同じことを言うページが、そこで炙り出される。

## まとめ

- **URLよりタイトルを疑う。** キーワードinURLは弱い要因で、移行コストに見合わない
- 編集的な見出しは価値がある。**捨てずに、`<title>` だけ差し替える**
- 打たれる語を先頭に、日本語を括弧で、70文字以内
- **未完成ページに検索向けタイトルを付けない。** 空ページへのクリックを誘うだけ
- クロールが近い順に直す
- この作業は副産物として**重複と主題の曖昧さを炙り出す**
