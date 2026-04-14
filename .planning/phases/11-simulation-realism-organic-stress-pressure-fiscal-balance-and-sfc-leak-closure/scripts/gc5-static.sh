#!/usr/bin/env bash
#
# gc5-static.sh — Static verification harness for Phase 11 gap closure.
#
# Runs every grep / count acceptance criterion from 11-GC1, 11-GC2, 11-GC3, 11-GC4.
# Emits one line per check (PASS/FAIL + actual value). Exits non-zero if any FAIL.
#
# Output is appended to 11-GC5-VERIFICATION.md (overwriting the automated section)
# so the Task 1b assertion step can cheaply grep for unfilled checkboxes.
#
# Usage:
#   bash .planning/phases/11-.../scripts/gc5-static.sh                       # stdout only
#   bash .planning/phases/11-.../scripts/gc5-static.sh --write-verification  # also updates VERIFICATION.md §2
#
set -u
PHASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$PHASE_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

FAIL=0
PASS_COUNT=0
FAIL_COUNT=0
RESULTS=()

# check <label> <expected_count> <grep-args...>
# expected_count: exact integer, or "+N" for ≥ N, or "0" for exactly zero
check_count() {
  local label="$1"; shift
  local expected="$1"; shift
  local actual
  actual=$(grep -c "$@" 2>/dev/null || echo 0)
  local status="FAIL"
  if [[ "$expected" == +* ]]; then
    local min="${expected#+}"
    if [[ "$actual" -ge "$min" ]]; then status="PASS"; fi
  else
    if [[ "$actual" == "$expected" ]]; then status="PASS"; fi
  fi
  if [[ "$status" == "PASS" ]]; then PASS_COUNT=$((PASS_COUNT+1)); else FAIL_COUNT=$((FAIL_COUNT+1)); FAIL=1; fi
  RESULTS+=("[$status] $label — expected $expected, actual $actual")
  echo "[$status] $label — expected $expected, actual $actual"
}

# check_exits <label> <cmd...>
check_exits() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then
    PASS_COUNT=$((PASS_COUNT+1))
    RESULTS+=("[PASS] $label — exit 0")
    echo "[PASS] $label — exit 0"
  else
    FAIL_COUNT=$((FAIL_COUNT+1)); FAIL=1
    RESULTS+=("[FAIL] $label — non-zero exit")
    echo "[FAIL] $label — non-zero exit"
  fi
}

echo "=== GC5 Static Verification Harness ==="
echo

echo "--- 11-GC1 (physics SFC leak) ---"
check_count "GC1: physicsUnderflowPool references"              "+3" "physicsUnderflowPool" "server/src/orchestration/simulationRunner.ts"
check_count "GC1: [PHYSICS-UNDERFLOW] trace literal"            "1"  "\\[PHYSICS-UNDERFLOW\\]" "server/src/orchestration/simulationRunner.ts"
check_count "GC1: Ghost seller guard (H2)"                      "1"  "Ghost seller" "server/src/orchestration/simulationRunner.ts"
check_count "GC1: Ghost buyer guard (H1)"                       "1"  "Ghost buyer" "server/src/orchestration/simulationRunner.ts"
check_count "GC1: sfcAudit bank-type filter"                    "1"  "agent.type !== 'bank'" "server/src/orchestration/helpers/sfcAudit.ts"

# INFO 8 — line-number scope check for physicsUnderflowPool
{
  open_line=$(awk '/const physicsBefore = snapshotTotal/ {print NR; exit}' server/src/orchestration/simulationRunner.ts 2>/dev/null)
  close_line=$(awk '/sfcBySubsystem\.physicsActions \+=/ {print NR; exit}' server/src/orchestration/simulationRunner.ts 2>/dev/null)
  if [[ -z "$open_line" || -z "$close_line" ]]; then
    echo "[FAIL] GC1 INFO-8: could not locate physicsActions bracket boundaries"
    FAIL=1; FAIL_COUNT=$((FAIL_COUNT+1))
    RESULTS+=("[FAIL] GC1 INFO-8 bracket-scope: boundaries not found")
  else
    out_of_range=0
    while IFS= read -r ln; do
      if [[ "$ln" -le "$open_line" || "$ln" -ge "$close_line" ]]; then
        out_of_range=$((out_of_range+1))
      fi
    done < <(awk '/physicsUnderflowPool/ {print NR}' server/src/orchestration/simulationRunner.ts)
    if [[ "$out_of_range" -eq 0 ]]; then
      echo "[PASS] GC1 INFO-8: all physicsUnderflowPool refs within physicsActions bracket ($open_line..$close_line)"
      PASS_COUNT=$((PASS_COUNT+1))
      RESULTS+=("[PASS] GC1 INFO-8 bracket-scope: all refs within ($open_line..$close_line)")
    else
      echo "[FAIL] GC1 INFO-8: $out_of_range physicsUnderflowPool refs OUTSIDE bracket ($open_line..$close_line)"
      FAIL=1; FAIL_COUNT=$((FAIL_COUNT+1))
      RESULTS+=("[FAIL] GC1 INFO-8: $out_of_range refs out of range")
    fi
  fi
}

echo
echo "--- 11-GC2 (context bloat) ---"
check_count "GC2: per-iteration trace reset"                    "1"  "sessionLastPhysicsTraces.set(sessionId, '')" "server/src/orchestration/simulationRunner.ts"
check_count "GC2: 8KB physicsLog slice"                         "1"  "physicsLog.slice(-8000)" "server/src/llm/prompts/central-agent.ts"

echo
echo "--- 11-GC3 (taxPolicy heuristic) ---"
check_count "GC3: composite gate — govExpensePct > 18"          "1"  "govExpensePct > 18" "server/src/data/dataBootstrapPipeline.ts"
check_count "GC3: composite gate — taxRevenuePct > 15"          "1"  "taxRevenuePct > 15" "server/src/data/dataBootstrapPipeline.ts"
check_count "GC3: composite gate — govDebtPct > 60"             "1"  "govDebtPct > 60" "server/src/data/dataBootstrapPipeline.ts"
check_count "GC3: old threshold removed (govExpensePct > 30)"   "0"  "govExpensePct > 30" "server/src/data/dataBootstrapPipeline.ts"
check_count "GC3: bootstrap invariant assertion"                "1"  "Bootstrap invariant violation" "server/src/routes/bootstrap.ts"
# WARNING 4 byte-preservation
check_count "GC3: progressive low-bracket body preserved"       "1"  -F "upto: 500,   rate: Math.max(0.05, incomeSeed / 2)" "server/src/data/dataBootstrapPipeline.ts"
check_count "GC3: progressive mid-bracket body preserved"       "1"  -F "upto: 2000,  rate: Math.max(0.10, incomeSeed * 0.8)" "server/src/data/dataBootstrapPipeline.ts"
check_count "GC3: progressive high-bracket body preserved"      "1"  -F "upto: 10000, rate: incomeSeed" "server/src/data/dataBootstrapPipeline.ts"

echo
echo "--- 11-GC4 (editable TaxPolicy) ---"
check_count "GC4: TaxPolicyEditor component exists"             "1"  "export function TaxPolicyEditor" "web/src/components/TaxPolicyEditor.tsx"
check_count "GC4: TaxPolicyReadout removed from EconomyTab"     "0"  "TaxPolicyReadout" "web/src/components/EconomyTab.tsx"
check_count "GC4: server validateTaxPolicy called"              "1"  "validateTaxPolicy(incoming.taxPolicy)" "server/src/routes/sessions.ts"
check_count "GC4: editor disabled-state"                        "1"  "opacity: 0.5" "web/src/components/TaxPolicyEditor.tsx"
check_count "GC4: theme-token-only (no hex)"                    "0"  -E "#[0-9a-fA-F]{3,6}" "web/src/components/TaxPolicyEditor.tsx"
# WARNING 5 — validation-logic grep
check_count "GC4: validation 'strictly increasing' error"       "+1" "strictly increasing" "web/src/components/TaxPolicyEditor.tsx"
check_count "GC4: validation 'At least one bracket' error"      "+1" "At least one bracket" "web/src/components/TaxPolicyEditor.tsx"
check_count "GC4: validation first-bracket-above-zero error"    "+1" -E "First bracket must start above zero|first bracket must start" "web/src/components/TaxPolicyEditor.tsx"

echo
echo "=== Summary: $PASS_COUNT PASS / $FAIL_COUNT FAIL ==="

if [[ "${1:-}" == "--write-verification" ]]; then
  VERIF="$PHASE_DIR/11-GC5-VERIFICATION.md"
  # Emit a checkbox block readable by Task 1b grep. Overwrite §2 contents — the file's
  # other sections (§1 test suite, §3 smoke test, §4 sign-off) are unchanged.
  {
    echo ""
    echo "<!-- gc5-static.sh auto-generated; do not edit by hand -->"
    echo "## §2 Automated Acceptance Criteria — Harness Output"
    echo ""
    echo "Run: \`bash .planning/phases/11-simulation-realism-organic-stress-pressure-fiscal-balance-and-sfc-leak-closure/scripts/gc5-static.sh --write-verification\`"
    echo ""
    for line in "${RESULTS[@]}"; do
      if [[ "$line" == "[PASS]"* ]]; then
        echo "- [x] ✅ ${line#\[PASS\] }"
      else
        echo "- [ ] ❌ ${line#\[FAIL\] }"
      fi
    done
    echo ""
    echo "Totals: $PASS_COUNT PASS / $FAIL_COUNT FAIL"
  } >> "$VERIF"
fi

exit $FAIL
