---
title: "npm Trusted Publishing に辿り着くまでに踏んだ地雷を全部書く"
emoji: "🔐"
type: "tech"
topics: ["npm", "githubactions", "oidc", "security", "cicd"]
published: false
---

npm パッケージを1本公開するのに、想定の何倍も手間取った。結果的には **Trusted Publishing（OIDC）** に落ち着いて、これが正解だったのだが、そこに至るまでに踏んだものを順番に書いておく。日本語の情報が少ない領域で、しかもどれも「言われてみれば当然」なのに事前には分からない類だった。

## 前提

- 新規の npm アカウント
- 2FA はセキュリティキー（WebAuthn）
- スコープ付きパッケージ `@scope/name` を公開したい
- 公開は自動化したい

## 地雷1：スコープ名は org とユーザーで名前空間を共有している

まず org を作ろうとした。

```
faanau is not available
```

作った覚えはない。調べると、org としてもパッケージ名としても空いている。

```
GET /-/org/faanau         → 404（空き）
GET /faanau               → 404（空き）
```

原因は**ユーザー名前空間との衝突**だった。npm では org 名とユーザー名が同じ名前空間にあり、同名のユーザーが存在すると org を作れない。

そして重要なのは、**ユーザーアカウントは自分の名前のスコープを自動的に所有する**という点だ。つまりユーザー名が `faanau` なら、org を作らなくても `@faanau/foo` を公開できる。

org が必要なのは、チームで権限管理したい場合だけ。個人でOSSを出すなら、ユーザースコープで十分。

**ただし後戻りできない。** ユーザー名がスコープを押さえてしまうと、同名の org は永久に作れない。将来チーム管理に移りたいなら、最初から org を作るべきだった。

## 地雷2：publish には 2FA が必須（無効だと 403）

意気揚々と publish したら弾かれた。

```
403 Forbidden
Two-factor authentication or granular access token with bypass 2fa
enabled is required to publish packages.
```

npm は公開パッケージの publish に 2FA を必須化している。アカウントの 2FA が無効だと、そもそも publish できない。

ここでの選択肢は2つ。

1. 2FA を有効にする
2. **「Bypass 2FA」付きの granular access token** を発行する

2 は npm の画面にこう書いてある。

> There are security risks with this option. For automation or CI/CD uses, please use Trusted Publishing instead.

npm 自身が「やめとけ」と言っている。素直に従うのが正解だった（後述）。

## 地雷3：セキュリティキーだと CLI publish が詰む

2FA を有効にした。認証方式はセキュリティキー（WebAuthn）を選んだ。フィッシング耐性があるので、選択としては正しい。

その状態で publish すると、こうなる。

```
npm error code EOTP
This operation requires a one-time password from your authenticator.
You can provide a one-time password by passing --otp=<code>
```

**6桁のコードを要求される。しかしセキュリティキーには6桁のコードが存在しない。**

`--auth-type=web` を付けるとブラウザ経由の認証フローになる、という情報はあるが、これは主に `npm login` 側の実装で、publish 時の挙動は取得済みトークンの種類に依存する。TOTP 前提で発行されたトークンだと、web フローに切り替わらないことがある。

打開策は3つ。

1. 認証アプリ（TOTP）を**追加**登録する。セキュリティキーは残したままでいい。npm は複数方式を登録できる
2. `npm logout && npm login --auth-type=web` でトークンを取り直す
3. **Trusted Publishing に移行する**（本命）

## 地雷4：`--dry-run` は OIDC を検証しない

Trusted Publishing に移行するにあたり、「まず dry-run で確認してから本番」という段取りを考えた。**これは無意味だった。**

`npm publish --dry-run` は**パッケージをローカルで固めるだけで、レジストリに一切接続しない**。つまり trusted publisher の設定が正しいかどうかは、dry-run では一切分からない。

正しい確認方法は、**本番実行してみること**。理屈はこうだ。

- 設定が誤っている → OIDC 認証で落ちる → **何も publish されない**
- 設定が正しい → publish される

危険なのは「間違って publish されること」だが、ワークフローに `npm test` を挟んでおけば壊れたものは出ない。**失敗しても無害なので、dry-run を挟む価値がない。**

なお既に公開済みのバージョンで試すと `403 already published` になり、**これは OIDC の設定ミスと区別がつかない**。検証したいならバージョンを上げること。

## 地雷5：Node 固定 + `npm@latest` は必ず壊れる

ワークフローの最初の実行が、publish 以前のところで落ちた。

```
npm error code EBADENGINE
npm@12.0.2 requires node ^22.22.2 || ^24.15.0 || >=26.0.0
actual: npm 10.9.2, node v22.14.0
```

こう書いていた。

```yaml
node-version: '22.14.0'        # trusted publishing の最小要件をそのまま固定
run: npm install -g npm@latest # 常に最新
```

Node は Trusted Publishing の最小要件（22.14.0）にピン留めし、npm は最新を追いかける、という組み合わせ。**この2つは別のリリース列なので、npm が新メジャーで Node 要件を上げた瞬間に必ず壊れる。**

修正はこう。

```yaml
node-version: '22'             # 22系の最新を拾う（セキュリティ修正も入る）
run: npm install -g npm@11     # メジャー固定。Node >= 22.9 対応、11.5.1 要件も満たす
```

さらに、次にずれたときに `EBADENGINE` のダンプではなく理由が1行で出るよう、明示的な検証を足した。

```yaml
- run: |
    npm install -g npm@11
    node -e 'const n=process.versions.node.split(".").map(Number); if (n[0]<22 || (n[0]===22 && n[1]<14)) { console.error("Trusted publishing needs Node >= 22.14.0, got "+process.versions.node); process.exit(1); }'
```

**この手の検証は、書いたあと必ず「落ちるべき入力」で試すこと。** 私は手元の npm 10.9.2 に対して実行し、ちゃんと拒否されることを確認した。書いただけで動かない検証は、無いより悪い。

## 地雷6：fine-grained PAT では他者リポジトリに PR を作れない

これは npm ではなく GitHub 側の話だが、同じ作業中に踏んだ。

上流に修正を還元しようと、API で PR を作ろうとした。

```
403 Resource not accessible by personal access token
```

**fine-grained PAT は、トークンのリソースオーナー外のリポジトリに対して PR を作成できない。** これは仕様上の制限で、権限を足しても解決しない。classic PAT か、ブラウザから操作するしかない。

さらにもう一段あった。フォークとして PR を出すには、**GitHub 上で「フォーク関係」が成立している必要がある**。API でリポジトリを新規作成して clone した履歴を push しただけでは、GitHub から見て無関係の別リポジトリなので、クロスリポジトリの compare 画面が空になる。

```
https://github.com/upstream/repo/compare/master...myorg:myrepo:branch
→ 「Choose different branches or forks above」
```

正しくは `POST /repos/{owner}/{repo}/forks` でフォークを作り、そこにブランチを push する。こちらは fine-grained PAT でも通った。

## 結論：Trusted Publishing にする

最終形はこれ。**トークンをどこにも保存しない。**

```yaml
name: Publish
on:
  release:
    types: [published]
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      id-token: write      # OIDC に必須
      contents: read
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          registry-url: 'https://registry.npmjs.org'
      - run: npm install -g npm@11
      - run: npm ci
      - run: npm test        # 通らないものは publish しない
      - run: npm publish --access public
```

`NODE_AUTH_TOKEN` も `NPM_TOKEN` も**無い**。npm 側の設定でこのワークフローの身元を信頼する、という形になる。

npmjs.com 側では、パッケージの設定で trusted publisher を登録する。

| 項目 | 値 |
|---|---|
| Organization or user | GitHub の org/ユーザー名 |
| Repository | リポジトリ名 |
| Workflow filename | `publish.yml`（**パスではなくファイル名だけ**） |
| Allowed actions | `npm publish` |

要件は **npm >= 11.5.1、Node >= 22.14.0、`id-token: write`**。

### なぜこれが「妥協」ではなく本当に良いのか

トークン方式と比べたとき、単に楽になるだけではない。

- **盗まれる秘密が存在しない。** OIDC トークンは実行ごとに発行され、数分で失効する
- **publish できる主体が「このリポジトリのこのファイル」に限定される。** 秘密情報より強い制約になる
- ローカルの `.npmrc` から publish 可能な認証情報を消せる

「セキュリティキーで 2FA を固めた直後に、それを迂回するトークンをディスクに置く」という本末転倒を避けられる。npm が警告文で誘導している理由がこれだと思う。

### 初回だけ問題が残る

**まだ存在しないパッケージに trusted publisher を設定できるかは、公式ドキュメントに記載がない。** 既存パッケージの設定手順しか書かれていない。

私の場合は初回だけ CLI から手動で publish し、パッケージが存在するようになってから trusted publisher を設定して、2回目以降を OIDC に切り替えた。PyPI の「pending publisher」に相当する仕組みが npm にもあるのかは確認できていない。

---

これは [@faanau/kuromoji](https://www.npmjs.com/package/@faanau/kuromoji) を公開したときの記録。8年放置されていた日本語形態素解析器のフォークで、その経緯は[別記事](https://zenn.dev/faanau/articles/oss-kuromoji-revival)に書いた。
