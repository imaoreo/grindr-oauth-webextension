#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

out=web-ext-artifacts
targets=(firefox chrome geckoview)

manifest_version() {
	grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]+"' "$1/manifest.json" | grep -oE '[0-9][^"]*'
}

selected=("$@")
[ "${#selected[@]}" -eq 0 ] && selected=("${targets[@]}")
for target in "${selected[@]}"; do
	case " ${targets[*]} " in
		*" $target "*) ;;
		*) echo "unknown target: $target (expected: ${targets[*]})" >&2; exit 1 ;;
	esac
done

version=$(manifest_version firefox)
for target in "${targets[@]}"; do
	if [ "$(manifest_version "$target")" != "$version" ]; then
		echo "version drift: $target/manifest.json is not $version" >&2
		exit 1
	fi
done

mkdir -p "$out"
for target in "${selected[@]}"; do
	stage="$out/$target"
	zip="grindr_oauth-$version-$target.zip"
	rm -rf "$stage" "${out:?}/$zip"
	mkdir -p "$stage"
	cp -R shared "$target/manifest.json" "$stage/"
	if [ -d "$target/overrides" ]; then
		(cd "$target/overrides" && tar cf - .) | (cd "$stage" && tar xf -)
	fi
	icon_refs=$(grep -oE '"icons/[^"]+"' "$target/manifest.json" | tr -d '"' | sort -u || true)
	if [ -n "$icon_refs" ]; then
		mkdir -p "$stage/icons"
		while IFS= read -r ref; do
			cp "$ref" "$stage/$ref"
		done <<< "$icon_refs"
	fi
	(cd "$stage" && zip -r -q -X "../$zip" . -x '*.DS_Store')
	echo "built $target -> $out/$zip"
done

if printf '%s\n' "${selected[@]}" | grep -qx firefox; then
	npx web-ext lint --source-dir "$out/firefox" || true
fi
