---
title: "コードを移植したら Zod が黙って機能を無効にしていた — 読む側だけコピーした話"
emoji: "🕳️"
type: "tech"
topics: ["zod", "astro", "typescript", "typesafety"]
published: false
---

既存プロジェクトのコンテンツ管理まわりを、新しいリポジトリに移植した。しばらくして、移植先でこういうコードを見つけた。

```ts
export function isPublished(entry: { data: any }): boolean {
  const d = entry.data;
  if (d?.noindex === true) return false;   // ← ここ
  ...
}
```

`noindex: true` が付いたエントリは公開対象から外す。ファイル冒頭のコメントにも書いてある。

```
 * A content entry is EXCLUDED from production when ANY is true:
 *   - data.noindex === true    (hard hide; not even in sitemap)
```

意図は明確で、実装もある。ドキュメントもある。

**でも動いていなかった。** しかも誰も気づいていなかった。

## 原因

Astro の Content Collections はスキーマを Zod で書く。そのスキーマにこう書いてあった。

```ts
const publishingFields = {
  approved:    z.boolean().default(false),
  approvedAt:  z.string().optional(),
  publishedAt: z.string().optional(),
  createdAt:   z.string().optional(),
  updatedAt:   z.string().optional(),
};
```

`noindex` が**無い**。

Zod の `z.object()` は既定で **strip** モードで、スキーマに宣言されていないキーを黙って捨てる。エラーにもならないし、警告も出ない。

だから JSON にこう書いても、

```json
{
  "slug": "some-entry",
  "noindex": true
}
```

パース後の `entry.data` に `noindex` は存在しない。`d?.noindex === true` は常に `false` を返す。

**「ドキュメント化された機能が、無言で無効になっていた」**という状態だった。

そして git log を見て、原因の性質が分かった。

```
移植元  フィルタ           あり
        スキーマ宣言        あり     ← 正しく動いていた
   ↓ 移植
移植先  フィルタ           あり
        スキーマ宣言        なし     ← ここで落ちた
```

**移植元は正しかった。** フィルタのファイルをコピーし、スキーマは移植先の既存の
ものを使ったため、「読む側」だけが運ばれて「宣言」が置き去りになった。

移植元のスキーマには、ちゃんとこう書いてあった。

```ts
noindex: z.boolean().default(false),
```

コピーしたファイルは正しい。コピーしなかったファイルとの関係が壊れていた。

## なぜ気づかなかったか

この不具合の性質が厄介なのは、**動かないことが観測できない**点だ。

- `noindex: true` を付けたエントリは、公開されないことを期待される
- 実際には公開される
- しかし「公開されている」ことは正常動作にも見える

エラーは出ない。型エラーも出ない（読む側は `data: any` だった）。テストは無い。**期待した効果が出ていないことに気づくには、意図的に確認しに行くしかない**。

そして誰も確認しに行かなかった。移植直後に `noindex` を使う場面が来ていなかったからだ。使おうとして、初めて動かないと分かった。

幸い9日で見つかったが、それは偶然この機能を使う用事ができたからにすぎない。
**使わなければ、何年でも気づかれない種類のバグ**だった。

## 型があっても防げない理由

TypeScript を使っていて、Zod でスキーマを書いていて、それでもこうなる。

Zod のスキーマは**書いた範囲についてしか保証しない**。宣言していないフィールドについては「存在しない」という保証を与えているのであって、それ自体は正しい動作だ。問題は、**別の場所にあるコードが「存在する」前提で書かれていた**こと。

```
JSON            noindex: true       ← 書き手はあると思っている
  ↓ Zod strip
data            (noindex なし)      ← ここで消える
  ↓
filter          d?.noindex === true ← 読み手もあると思っている
```

`?.` が効いてしまうのも良くない。`d.noindex` なら `undefined` になるだけで同じだが、Optional chaining があると「無いかもしれない」ことが意図的に見える。**実際には「あるはずのものが無い」状態だったのに、コードは「無くても大丈夫」と書かれていた。**

## 対策

### 1. スキーマに宣言する（当たり前だが）

```ts
noindex: z.boolean().default(false),
```

これで動くようになった。

### 2. strict にして早期に落とす

`.strict()` を付けると、未知のキーがあった時点でパースエラーになる。

```ts
const schema = z.object({ ... }).strict();
```

今回のケースなら、`noindex` を書いた瞬間に「そんなフィールドは無い」と怒られる。**書き手のタイポや、スキーマ更新漏れをその場で検出できる。**

ただし既存の大きなコンテンツ資産に後から `.strict()` を入れると、レガシーな余剰フィールドで一斉に落ちる可能性がある。移行コストは見積もった方がいい。

### 3. `data: any` をやめる

読む側が `any` だったことも効いている。

```ts
export function isPublished(entry: { data: any }): boolean
```

Zod は `z.infer` で型を出せる。読む側がその型を使っていれば、`data.noindex` は**コンパイルエラーになっていた**。スキーマに無いプロパティにアクセスしているのだから当然だ。

型は付いていたが、**境界で `any` に落としていたので効いていなかった**。よくある形だと思う。

### 4. 「効いていること」をテストする

いちばん確実なのはこれだ。

```ts
it('excludes an entry marked noindex', async () => {
  const entries = await getPublishedCollection('wisdom');
  expect(entries.map(e => e.data.slug)).not.toContain('deliberately-hidden');
});
```

フィルタの実装をテストするのではなく、**フィルタが効いた結果**をテストする。実装が正しくてもデータが届いていなければ落ちるので、今回のような「経路が切れている」バグを捕まえられる。

## 一般化

このパターンは Zod に限らない。

- **バリデーション層が未知フィールドを捨てる**（Zod strip、Mongoose の strict、GraphQL の入力型、etc.）
- **その先のコードが、捨てられたフィールドを読んでいる**
- **どちらも単体では正しい**

境界で静かにデータが落ちる設計は、**両側を別々にレビューしても見つからない**。片方だけ見ると、どちらも正しく書けているからだ。

そして**移植は、この「両側」を引き裂く**。ファイル単位でコピーすると、
ファイルをまたいだ暗黙の契約だけが運ばれない。移植元でレビュー済みだから
安心、とはならない。

今回の教訓を一言でまとめるなら、**「読んでいるフィールドが、本当にそこまで届いているか」を確認するテストを書け**、ということになる。実装のテストではなく、経路のテストを。

移植するときは特に。**動いていたコードをコピーしても、動いていた理由まではコピーされない。**

---

この修正を含む一連の作業は [jpn.fan](https://jpn.fan) で行った。漫画の日本語を英語圏の学習者向けに読み解くサイトで、コンテンツは Astro の Content Collections + Zod で管理している。
