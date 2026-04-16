#!/usr/bin/env bash
# Creates a git tag for the current HEAD based on package.json version.
# Fails loudly if:
#   - working tree is dirty
#   - current branch is not main
#   - tag already exists
#   - unpushed commits would be missed
#
# Usage: npm run release:tag
# After: git push origin "v$(node -p "require('./package.json').version")"

set -euo pipefail

red() { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

if [ -n "$(git status --porcelain)" ]; then
  red "Working tree is dirty — commit or stash before tagging."
  git status --short >&2
  exit 1
fi

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
  red "Refusing to tag from branch '$branch' — switch to main."
  exit 1
fi

git fetch --tags origin main >/dev/null 2>&1 || true

if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  red "Local main differs from origin/main. Pull or push first."
  git log --oneline --decorate HEAD..origin/main origin/main..HEAD 2>&1 | head -20 >&2
  exit 1
fi

version=$(node -p "require('./package.json').version")
tag="v${version}"

if git rev-parse "$tag" >/dev/null 2>&1; then
  red "Tag $tag already exists — bump version in package.json first."
  exit 1
fi

sha=$(git rev-parse --short HEAD)
message="Release $tag ($sha)"

yellow "About to create annotated tag:"
yellow "  tag:     $tag"
yellow "  commit:  $sha"
yellow "  branch:  $branch"
yellow "  message: $message"

read -rp "Proceed? [y/N] " reply
case "$reply" in
  [yY]|[yY][eE][sS]) ;;
  *) red "Aborted."; exit 1 ;;
esac

git tag -a "$tag" -m "$message"
green "Created $tag. Push with: git push origin $tag"
