#!/usr/bin/env bash
# Migrate CLI release tags msctl-vX.Y.Z → vX.Y.Z on GitHub (tags + releases).
# Idempotent: skips when v* already exists at the same commit as msctl-v*.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-yakami129/multisoul}"

resolve_commit_sha() {
  local tag="$1"
  local payload
  payload="$(gh api "repos/${REPO}/git/refs/tags/${tag}")"
  local obj_type obj_sha
  obj_type="$(echo "$payload" | jq -r '.object.type')"
  obj_sha="$(echo "$payload" | jq -r '.object.sha')"
  if [ "$obj_type" = "tag" ]; then
    gh api "repos/${REPO}/git/tags/${obj_sha}" --jq '.object.sha'
  else
    echo "$obj_sha"
  fi
}

tag_exists() {
  gh api "repos/${REPO}/git/refs/tags/${1}" &>/dev/null
}

create_v_tag() {
  local new_tag="$1"
  local sha="$2"
  if tag_exists "$new_tag"; then
    echo "  skip create: ${new_tag} already exists"
    return 0
  fi
  gh api -X POST "repos/${REPO}/git/refs" \
    -f "ref=refs/tags/${new_tag}" \
    -f "sha=${sha}" >/dev/null
  echo "  created tag ${new_tag} @ ${sha:0:7}"
}

retarget_release() {
  local old_tag="$1"
  local new_tag="$2"
  if ! gh release view "$old_tag" &>/dev/null; then
    echo "  no release for ${old_tag}"
    return 0
  fi
  gh release edit "$old_tag" --tag "$new_tag" --title "$new_tag"
  echo "  release retargeted: ${old_tag} → ${new_tag}"
}

delete_old_tag() {
  local old_tag="$1"
  if ! tag_exists "$old_tag"; then
    echo "  skip delete: ${old_tag} already gone"
    return 0
  fi
  gh api -X DELETE "repos/${REPO}/git/refs/tags/${old_tag}" >/dev/null
  echo "  deleted tag ${old_tag}"
}

OLD_TAGS=()
while IFS= read -r tag; do
  OLD_TAGS+=("$tag")
done < <(
  gh api "repos/${REPO}/git/refs/tags" --paginate -q '.[].ref' \
    | sed 's|^refs/tags/||' \
    | grep '^msctl-v' \
    | sort -V
)

if [ "${#OLD_TAGS[@]}" -eq 0 ]; then
  echo "No msctl-v* tags found on ${REPO}."
  exit 0
fi

echo "Migrating ${#OLD_TAGS[@]} tag(s) on ${REPO}..."

for old_tag in "${OLD_TAGS[@]}"; do
  new_tag="${old_tag#msctl-}"
  echo "== ${old_tag} → ${new_tag} =="
  sha="$(resolve_commit_sha "$old_tag")"

  if tag_exists "$new_tag"; then
    existing_sha="$(resolve_commit_sha "$new_tag")"
    if [ "$existing_sha" != "$sha" ]; then
      echo "ERROR: ${new_tag} exists at different commit (${existing_sha:0:7} vs ${sha:0:7})" >&2
      exit 1
    fi
    echo "  ${new_tag} already at same commit"
  else
    create_v_tag "$new_tag" "$sha"
  fi

  retarget_release "$old_tag" "$new_tag"
  delete_old_tag "$old_tag"
done

echo "Done. Verify: gh release list --limit 10"
