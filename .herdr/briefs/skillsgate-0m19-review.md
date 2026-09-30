# Review Assignment Brief: [skillsgate-0m19] - Independent Adversarial Review

- **Bean ID**: `skillsgate-0m19`
- **Target Commit**: `4d4f23865cb3e5224b2bb025c7c868567ab270ee`
- **Author Branch**: `fleet/agy-coder-1`
- **Author Agent**: `agy-coder-1`
- **Coder family**: `bulk`
- **Reviewer family**: `review` (ternary rule P1-1: must differ from coder family)

## 1. Review Objective
Perform an independent, adversarial code review of commit `4d4f23865cb3e5224b2bb025c7c868567ab270ee` for Bean `skillsgate-0m19`. Validate specification compliance, run full test verification suites, inspect backward compatibility, and construct boundary/negative edge tests to prevent defects from reaching main.

## 2. Review Acceptance Criteria & Verification Steps (Execute in Worktree)
1. **Verification Gate**:
   Run the project-wide composite verification gate configured for this fleet:
   ```bash
   cd packages/cli && bun run test
   ```
   Verify: type-check/lint, all unit test suites pass with 100% success, and the production build succeeds without compilation failures. If the command above is wrong for this repo, correct it via `FLEET_TEST_CMD` or `.herdr/config/fleet.json` (`test_command`) — do not silently skip verification.

2. **Domain & Architectural Compliance**:
   - Inspect changes against the repo's documented decisions and contracts (ADRs, API contracts, AGENTS.md/CLAUDE.md conventions).
   - Check layering: interface/route layers stay thin (schema parsing, status dispatch); business logic lives in domain/service layers.
   - Check error handling, status/exit codes, and input validation at trust boundaries.

3. **Adversarial Edge & Corner Cases**:
   - Verify negative cases: unauthorized access, expired/invalid tokens, malformed payloads, out-of-range numerical bounds.
   - Verify concurrency/atomic transactions if applicable.

## 3. Deliverables & Required Rubric
Emit the final review report at `.herdr/reports/skillsgate-0m19-review.md` with standard header and rubric:
```markdown
# Review Report: [skillsgate-0m19] - Code Review

- **Bean ID**: `skillsgate-0m19`
- **Agent**: `<reviewer-agent>`
- **Reviewed Commit**: `4d4f23865cb3e5224b2bb025c7c868567ab270ee`
- **Status**: Approved / Changes Requested

## Gated Rubric
BEAN: MET
LANDABLE: YES
VERDICT: APPROVE

## Assessment
### 1. Specification Compliance
### 2. Code Quality, Security & Performance
### 3. Verification Output (cd packages/cli && bun run test)
```

## 4. Status Announcement
When finished, announce your review verdict:
- If APPROVED:
  `./.agents/skills/herdr-run/scripts/fleet-done <reviewer-agent> skillsgate-0m19 DONE "Review passed: approved for landing" .herdr/reports/skillsgate-0m19-review.md`
- If CHANGES REQUESTED:
  `./.agents/skills/herdr-run/scripts/fleet-done <reviewer-agent> skillsgate-0m19 CHANGES "Review requested changes: <key reasons>" .herdr/reports/skillsgate-0m19-review.md`
