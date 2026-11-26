#!/usr/bin/env bash
set -euo pipefail

skip_without_base=false
base=""
for arg in "$@"; do
  case "$arg" in
    --skip-without-base) skip_without_base=true ;;
    -*)
      echo "unknown option: $arg" >&2
      exit 2
      ;;
    *) base="$arg" ;;
  esac
done
if [ -z "$base" ]; then
  echo "usage: $0 [--skip-without-base] <base-ref>" >&2
  exit 2
fi

escape_data() {
  local text=${1//'%'/%25}
  text=${text//$'\r'/%0D}
  printf '%s' "${text//$'\n'/%0A}"
}

fail() {
  echo "::error title=$1::$(escape_data "$2")"
  exit 1
}

root=$(git rev-parse --show-toplevel) || fail "Gitのリポジトリではない" "scripts/mutation-diff.shはGitのリポジトリの中で実行してください。"
cd "$root"
tracked=$(git ls-files -- .mutator .mutator-base)
if [ -n "$tracked" ]; then
  fail "ミューテーションテストの結果がgitで追跡されている" "$(printf '%s\n' "$tracked" | head -n 5)がgitで追跡されています。基準や結果をコミットで差し替えられないよう、git rm --cachedで追跡を外してください。"
fi
if ! git rev-parse --verify --quiet "${base}^{commit}" >/dev/null; then
  if [ "$skip_without_base" = true ]; then
    echo "mutation:diff: skipped because ${base} does not exist"
    exit 0
  fi
  fail "基準のrefが無い" "${base}がありません。refの名前と、履歴を取得しているか(CIではfetch-depth: 0)を確かめてください。"
fi
merge_base=$(git merge-base "$base" HEAD) ||
  fail "基準のコミットが無い" "${base}とHEADの共通の祖先がありません。履歴を取得しているか(CIではfetch-depth: 0)を確かめてください。"

lock=$(git rev-parse --path-format=absolute --git-path mutation-diff.lock)
take_lock() { (set -o noclobber && echo "$$" >"$lock") 2>/dev/null; }
busy() {
  fail "mutation:diffが動いている" "同じ作業ツリーで、別のmutation:diff($1)が動いています。.mutatorと.mutator-baseを取り合うので、終わってから実行してください。"
}
if ! take_lock; then
  mkdir "$lock.takeover" 2>/dev/null ||
    busy "古いロックを取り直している所。そのプロセスが強制終了されて残ったなら、${lock}.takeoverを消してください"
  holder=$(sed -n 1p "$lock" 2>/dev/null || true)
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
    rmdir "$lock.takeover"
    busy "プロセス${holder}"
  fi
  stale=$(sed -n 2p "$lock" 2>/dev/null || true)
  case "$stale" in
    "${TMPDIR:-/tmp}"/mutation-base.*)
      git worktree remove --force "$stale/tree" >/dev/null 2>&1 || true
      rm -rf "$stale"
      ;;
  esac
  git worktree prune
  rm -f "$lock"
  take_lock || {
    rmdir "$lock.takeover"
    busy "古いロックを取り直す間に始まったもの"
  }
  rmdir "$lock.takeover"
fi

cache="$root/.mutator-base"
work=$(mktemp -d "${TMPDIR:-/tmp}/mutation-base.XXXXXX")
printf '%s\n%s\n' "$$" "$work" >"$lock"
tree="$work/tree"
trap 'git -C "$root" worktree remove --force "$tree" >/dev/null 2>&1 || true
rm -rf "$work"
git -C "$root" worktree prune
rm -f "$lock"' EXIT
trap 'exit 130' INT TERM

no_baseline() {
  local excerpt
  excerpt=$(grep -v '^[[:space:]]*$' "$work/baseline.log" | tail -n 8 | cut -c1-300 || true)
  echo "--- baseline log (last 40 lines) ---" >&2
  tail -n 40 "$work/baseline.log" >&2 || true
  fail "ミューテーションテストの基準を作れない" "${merge_base}(${base}との共通の祖先)で$1。テストが弱くなったかを確かめられないため、失敗にします。依存を更新してテストが壊れたなら、まず単体テスト(pnpm test:unit)を直してください。Vitestの設定から辿れないファイルをテストが読むようにしたなら、scripts/mutation-diff.shが基準へ写すファイルに足してください。出力の末尾:
${excerpt}"
}

copy_snapshots() {
  mkdir -p "$2/scopes"
  local snapshot
  for snapshot in "$1"/scopes/*.json; do
    if [ -f "$snapshot" ]; then cp "$snapshot" "$2/scopes/"; fi
  done
  if [ -f "$1/snapshot.json" ]; then cp "$1/snapshot.json" "$2/"; fi
  local copied_snapshots=("$2"/scopes/*.json)
  if [ -f "$2/snapshot.json" ]; then copied_snapshots+=("$2/snapshot.json"); fi
  node -e 'const fs = require("node:fs")
const escape = (text) => text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")
const [from, ...files] = process.argv.slice(1)
for (const file of files.filter((path) => fs.existsSync(path))) {
  try {
    const snapshot = JSON.parse(fs.readFileSync(file, "utf8"))
    delete snapshot.testReview
    fs.writeFileSync(file, JSON.stringify(snapshot))
  } catch (error) {
    console.log(`::error title=ミューテーションテストのsnapshotを読めない::${escape(`${from}の${file.split("/").pop()}を読めません: ${error.message}`)}`)
    process.exit(1)
  }
}' "$1" "${copied_snapshots[@]}"
}

copied=()
copy_into_tree() {
  local file
  for file in "$@"; do
    rm -f "$tree/$file"
    if [ -f "$file" ]; then
      mkdir -p "$tree/$(dirname "$file")"
      cp "$file" "$tree/$file"
      copied+=("$file")
    fi
  done
}

started=$(date +%s)
echo "mutation:diff: making the baseline at ${merge_base} (${base})"
: >"$work/baseline.log"
git worktree add --detach --quiet "$tree" "$merge_base" >>"$work/baseline.log" 2>&1 || no_baseline "worktreeを作れません"

node scripts/mutation-scope.ts >"$work/scope.json" 2>"$work/scope.log" ||
  fail "テストと対象の一覧を作れない" "今の作業ツリーで、scripts/mutation-scope.tsが失敗しました: $(tail -n 5 "$work/scope.log")"
vitest_files=$(node scripts/mutation-vitest-files.ts 2>"$work/vitest-files.log") ||
  fail "Vitestの設定を読めない" "scripts/mutation-vitest-files.tsが失敗しました: $(tail -n 5 "$work/vitest-files.log")"
test_setup=()
while IFS= read -r file; do
  if [ -n "$file" ]; then test_setup+=("$file"); fi
done <<<"$vitest_files"
watched=("${test_setup[@]}")
shopt -s nullglob
for file in vitest.config.* vitest.*.config.*; do
  case " ${watched[*]} " in
    *" $file "*) ;;
    *) watched+=("$file") ;;
  esac
done
shopt -u nullglob

copy_into_tree package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc
(cd "$tree" && pnpm install --frozen-lockfile --offline --ignore-scripts) >>"$work/baseline.log" 2>&1 ||
  no_baseline "依存を入れられません"
(cd "$tree" && node "$root/scripts/mutation-scope.ts") >"$work/base-scope.json" 2>>"$work/baseline.log" ||
  no_baseline "分岐点の設定で、テストと対象の一覧を作れません"

shopt -s nullglob
settings=(tsconfig*.json mutator.config.ts mutator.config.mts mutator.config.mjs mutator.config.js mutator.config.json)
for file in "$tree"/tsconfig*.json; do settings+=("${file#"$tree/"}"); done
shopt -u nullglob
copy_into_tree "${settings[@]}" "${test_setup[@]}"
echo "mutation:diff: copied $(printf '%s\n' "${copied[@]}" | sort -u | tr '\n' ' ')"

key="${merge_base}-$({
  node --version
  for file in "${copied[@]}"; do
    printf '%s\0' "$file"
    cat "$file"
  done
} | sha256sum | cut -c1-16)"

reused=""
if [ -d "$cache/$key" ]; then
  reused="$key"
elif [ -d "$cache" ]; then
  reused=$(ls -1t "$cache" | grep -v '\.new$' | sed -n 1p || true)
fi
if [ -n "$reused" ]; then
  copy_snapshots "$cache/$reused" "$tree/.mutator"
  echo "mutation:diff: starting from .mutator-base/$reused"
fi
(cd "$tree" && GITHUB_ACTIONS='' pnpm exec mutator --reporter json) >>"$work/baseline.log" 2>&1 ||
  no_baseline "全件のミューテーションテストが失敗しました(今の依存でベースの単体テストが落ちる、など)"
grep -E '^[0-9]+ mutants, ' "$work/baseline.log" | sed 's/^/mutation:diff: baseline: /' || true
cp "$tree/.mutator/report/mutation.json" "$work/base-report.json" 2>>"$work/baseline.log" &&
  cp "$tree/.mutator/snapshot.json" "$work/base-snapshot.json" 2>>"$work/baseline.log" ||
  no_baseline "基準のレポートかsnapshot(.mutator/report/mutation.json、.mutator/snapshot.json)がありません"
rm -rf "${cache:?}/$key.new"
copy_snapshots "$tree/.mutator" "$cache/$key.new"
rm -rf "${cache:?}/$key"
mv "$cache/$key.new" "$cache/$key"
touch "$cache/$key"
ls -1 "$cache" | grep '\.new$' | while IFS= read -r old; do rm -rf "${cache:?}/$old"; done || true
ls -1t "$cache" | tail -n +4 | while IFS= read -r old; do rm -rf "${cache:?}/$old"; done
echo "mutation:diff: baseline made in $(($(date +%s) - started))s"

status=0
for name in mutator.config.ts mutator.config.mts mutator.config.mjs mutator.config.js mutator.config.json; do
  rm -f "$tree/$name"
  if git cat-file -e "$merge_base:$name" 2>/dev/null; then git show "$merge_base:$name" >"$tree/$name"; fi
done
(cd "$tree" && node "$root/scripts/mutation-original.ts" "$root" "$work") || status=1

rm -rf .mutator
copy_snapshots "$cache/$key" .mutator
GITHUB_ACTIONS='' pnpm exec mutator --since "$merge_base" --include-test-changes --kill-matrix --reporter text --reporter json 2>&1 |
  tee "$work/diff.log" ||
  fail "ミューテーションテストが失敗した" "mutator --since ${merge_base}が失敗しました。上の出力を確かめてください。"
not_run=$(grep -m 1 '^not run: ' "$work/diff.log" || true)
if [ -n "$not_run" ]; then
  echo "::error title=範囲内のミュータントが実行されなかった::$(escape_data "差分の実行で、mutatorが範囲内のミュータントを実行せずに残しました(${not_run})。テストが弱くなったかを確かめられないので失敗にします。mutatorの設定のtimeBudgetやmutantsPerLineなど、実行を減らす設定を外してください。")"
  status=1
fi
findings=(node scripts/mutation-findings.ts "$merge_base" --base-scope "$work/base-scope.json" --scope "$work/scope.json")
for file in "${watched[@]}"; do findings+=(--test-setup "$file"); done
"${findings[@]}" || status=1
node scripts/mutation-recheck.ts "$work" "$merge_base" || status=1
echo "mutation:diff: done in $(($(date +%s) - started))s"
exit "$status"
