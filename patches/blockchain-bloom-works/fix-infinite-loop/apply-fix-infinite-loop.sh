#!/usr/bin/env bash
# =============================================================================
# apply-fix-infinite-loop.sh
#
# Applies the three-file fix for the infinite-loop bug that freezes the screen
# when the "Bespoke" company is selected on the client page.
#
# Run this script from the ROOT of the blockchain-bloom-works repository on
# branch  copilot/replace-supabase-with-postgresql-again :
#
#   bash /path/to/Bespoke/patches/blockchain-bloom-works/fix-infinite-loop/apply-fix-infinite-loop.sh
#
# Bugs fixed by these patches
# ----------------------------
# 1. useCompanyCountry.ts  – `supabase` was used without being imported,
#    causing a ReferenceError on every call.  Also, `handleUpdateCountry`
#    was not wrapped in useCallback, so it produced a new function reference
#    on every render.  Both issues together caused ClientDetails.tsx to
#    re-trigger the effect that calls handleUpdateCountry on every render,
#    creating an infinite loop that froze the screen.
#    FIXED: add missing `import { supabase }` and wrap in useCallback.
#
# 2. ClientDetails.tsx  – The useEffect dep array now correctly includes
#    `handleUpdateCountry` (which is now stable thanks to fix #1).  The
#    condition `companyData.Country && !country` prevents repeated calls
#    once the country has been set.
#
# 3. useComplianceValidation.ts  – `isVerificationValid` was not memoized
#    with useCallback, so the useMemo in useComplianceItems always recomputed
#    (its dep `isVerificationValid` always changed), producing a new
#    complianceItems array every render and causing cascade re-renders.
#    FIXED: wrap isVerificationValid in useCallback([], []).
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Verify we are inside blockchain-bloom-works
if [[ ! -f "package.json" ]] || ! grep -q '"blockchain-bloom-works"\|"name"' package.json 2>/dev/null; then
  if [[ ! -d "src/hooks/client" ]]; then
    echo "ERROR: Please run this script from the root of the blockchain-bloom-works repository."
    exit 1
  fi
fi

echo "=== Applying fix: useCompanyCountry.ts ==="
TARGET1="src/hooks/client/useCompanyCountry.ts"
if [[ ! -f "$TARGET1" ]]; then
  echo "ERROR: $TARGET1 not found. Are you in the right repository?"
  exit 1
fi
cp "$SCRIPT_DIR/useCompanyCountry.ts" "$TARGET1"
echo "    ✓ $TARGET1 replaced"

echo "=== Applying fix: ClientDetails.tsx ==="
TARGET2="src/pages/ClientDetails.tsx"
if [[ ! -f "$TARGET2" ]]; then
  echo "ERROR: $TARGET2 not found. Are you in the right repository?"
  exit 1
fi
cp "$SCRIPT_DIR/ClientDetails.tsx" "$TARGET2"
echo "    ✓ $TARGET2 replaced"

echo "=== Applying fix: useComplianceValidation.ts ==="
TARGET3="src/components/company/verification/hooks/useComplianceValidation.ts"
if [[ ! -f "$TARGET3" ]]; then
  echo "ERROR: $TARGET3 not found. Are you in the right repository?"
  exit 1
fi
cp "$SCRIPT_DIR/useComplianceValidation.ts" "$TARGET3"
echo "    ✓ $TARGET3 replaced"

echo ""
echo "=== All fixes applied successfully. ==="
echo ""
echo "Next steps:"
echo "  1. npm run build   # verify no TypeScript errors"
echo "  2. git add src/hooks/client/useCompanyCountry.ts \\"
echo "           src/pages/ClientDetails.tsx \\"
echo "           src/components/company/verification/hooks/useComplianceValidation.ts"
echo "  3. git commit -m 'fix: resolve infinite loop when selecting Bespoke company'"
echo "  4. git push"
