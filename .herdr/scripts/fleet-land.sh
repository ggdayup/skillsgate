#!/usr/bin/env bash
# fleet-land.sh: Mechanical landing guard for herdr-run
# Usage: ./scripts/fleet-land.sh <bean-id> <commit-hash> [test-command]
#
# Enforces Tenet 7, 8 & 9:
# 1. Verifies .herdr/reports/<bean-id>-review.md exists.
# 2. Verifies review verdict is APPROVE and LANDABLE is YES.
# 3. Executes build and tests in an isolated verify branch.
# 4. Merges to main with --no-ff.
# 5. Closes the Bean.

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <bean-id> <commit-hash> [test-command]" >&2
  exit 1
fi

BEAN="$1"
COMMIT="$2"
TEST_CMD="${3:-}"

# Check git status is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working directory is not clean. Commit or stash changes before landing." >&2
  exit 1
fi

# Check on main branch
CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "Error: Must land from 'main' branch (current: $CURRENT_BRANCH)" >&2
  exit 1
fi

# Check review report exists
REVIEW_REPORT=".herdr/reports/${BEAN}-review.md"
if [ ! -f "$REVIEW_REPORT" ]; then
  echo "Error: Cannot land without review artifact ($REVIEW_REPORT)." >&2
  echo "Run formal review first and emit $REVIEW_REPORT with standard rubric:" >&2
  echo "  BEAN: MET" >&2
  echo "  LANDABLE: YES" >&2
  echo "  VERDICT: APPROVE" >&2
  exit 1
fi

# Check review verdict
if ! grep -E -q "VERDICT:[[:space:]]*APPROVE" "$REVIEW_REPORT"; then
  echo "Error: Review verdict in $REVIEW_REPORT is not APPROVE. Landing blocked!" >&2
  exit 1
fi

if ! grep -E -q "LANDABLE:[[:space:]]*YES" "$REVIEW_REPORT"; then
  echo "Error: LANDABLE in $REVIEW_REPORT is not YES. Landing blocked!" >&2
  exit 1
fi

echo "==> Gated Review Passed for $BEAN:"
grep -E "(BEAN|LANDABLE|VERDICT):" "$REVIEW_REPORT" || true

# Check out or create verify branch
echo "==> Preparing verification branch 'verify' from main..."
git checkout -B verify main

# Cherry-pick the approved commit
echo "==> Cherry-picking commit $COMMIT..."
git cherry-pick "$COMMIT"

# Run tests if provided
if [ -n "$TEST_CMD" ]; then
  echo "==> Running verification test suite: $TEST_CMD"
  eval "$TEST_CMD"
fi

# Merge back to main with --no-ff
echo "==> Merging verify to main with --no-ff..."
git checkout main
BEAN_TITLE="$(beans show "$BEAN" --json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('title',''))" 2>/dev/null || echo "$BEAN")"
git merge --no-ff verify -m "land($BEAN): $BEAN_TITLE"

# Cleanup verify branch
git branch -D verify

# Update Bean to completed
if command -v beans >/dev/null 2>&1; then
  echo "==> Updating bean status to completed..."
  beans update "$BEAN" -s completed 2>/dev/null || true
fi

echo "==> [fleet-land] Successfully landed $BEAN on main!"
