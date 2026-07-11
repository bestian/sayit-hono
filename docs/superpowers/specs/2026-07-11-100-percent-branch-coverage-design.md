# Design Spec: 100% Branch Coverage Pass

**Date:** 2026-07-11
**Status:** Approved design
**Scope:** Branch coverage only; this pass does not prescribe implementation of any production feature.

## Goal and baseline

Raise the repository's branch coverage to an actual 100% without weakening the behavior contract or manipulating coverage accounting.

The baseline is **1,298 / 1,434 branches (90.51%)**, with **136 uncovered arms across 18 files**. The denominator is the instrumented code as reported by the existing coverage command. The work is complete only when all four reported metrics—statements, branches, functions, and lines—are 100%.

## Approach: contract-first, file by file

Work proceeds file by file, starting from the behavior contract owned by each module:

1. Inventory every uncovered arm and identify the observable behavior it protects (or the invariant that makes it impossible).
2. Read the owning implementation and its existing behavior-owning spec before adding or changing a test.
3. For reachable arms, write the smallest deterministic test that exercises the real contract, then confirm the arm is covered.
4. For an arm proven impossible under an enforced invariant, delete or simplify the dead branch at its source; do not add a test for an unreachable state.
5. Re-run focused tests and coverage after each file, then proceed to the next file.
6. Review the resulting diff for accidental behavior changes and ensure every uncovered arm has an explicit disposition.

This is a contract-first pass, not a line-oriented exercise. A test is valuable because it specifies behavior at an HTTP, rendering, cache, D1, R2, ordering, or error boundary—not because it executes a syntactic line.

## Priority order and work inventory

The first six files are handled in this order, because they contain the largest uncovered-arm clusters:

| Priority | File | Uncovered arms |
| ---: | --- | ---: |
| 1 | `src/ssr/pages/speech.ts` | 33 |
| 2 | `src/api/upload_markdown.ts` | 19 |
| 3 | `src/api/an.ts` | 14 |
| 4 | `src/ssr/pages/speaker.ts` | 12 |
| 5 | `src/index.ts` | 11 |
| 6 | `src/ssr/pages/search.ts` | 10 |

After those priorities, cover the **remaining 12 files** (37 uncovered arms in aggregate), in dependency and behavior-flow order. The exact ordering of those 12 may be adjusted after the inventory, but no file or arm may be silently deferred. The inventory must reconcile to all 136 baseline uncovered arms across all 18 files.

## Test placement and contract requirements

- New tests go into the existing behavior-owning spec for the module under test. If a suitable spec does not exist, add the narrowest module-owned spec alongside that module.
- Do **not** create a catch-all coverage file or a suite whose purpose is merely to inflate the denominator.
- Tests must assert observable contracts, including as applicable:
  - HTTP status, headers, body, redirects, and method behavior;
  - rendered output and rendering fallbacks;
  - cache hit/miss behavior, cache headers, and invalidation decisions;
  - D1 queries, result handling, and transaction/error outcomes;
  - R2 object lookup, missing-object behavior, and object errors;
  - deterministic ordering, tie-breaking, and empty-result behavior;
  - expected errors, malformed inputs, and failure propagation.
- Reachable malformed-input and boundary arms must receive tests. Include empty collections, absent/optional values, limits and endpoints, invalid route or payload shapes, and dependency failures wherever those states are reachable through the public behavior.
- When an arm is proven impossible because an enforced invariant already excludes it, delete or simplify the branch rather than manufacturing an impossible fixture. The invariant must be explicit in the implementation or its validation boundary, and the simplification must preserve the observable contract.

## Coverage policy

No Istanbul/V8 ignore annotations, coverage exclusions, pragmas, generated-file tricks, denominator changes, or equivalent accounting workarounds are allowed. Do not flatten or rewrite production source solely to make instrumentation easier. Production simplification is allowed only when it removes a genuinely impossible branch under an enforced invariant.

Only after the suite reaches **actual 100% branch coverage** may the branch threshold be changed to 100%. The threshold change must be the final coverage-policy edit, so an artificially passing threshold cannot mask remaining work. All four metrics must be at 100% at that point.

## Verification sequence

Use focused verification throughout, then run the complete required checks after the final threshold change:

1. Run the focused spec(s) for the file just covered, including the new malformed/boundary and error-contract cases.
2. Run `bun run check`.
3. Run `bun run test:coverage` and verify **100% statements, 100% branches, 100% functions, and 100% lines** (not merely a passing threshold).
4. Run `bun run build`.
5. Run the repository's actual pre-commit check/hook in the same environment used for commits; do not substitute a claimed or simulated pre-commit result.
6. Inspect the final diff and coverage report to confirm that only intended tests, justified source simplifications, and the threshold change are present, with no ignores, exclusions, or denominator tricks.

## Alternatives rejected

### Catch-all coverage file

Rejected because it separates tests from the behavior they own, encourages implementation-shaped assertions, obscures which contract each arm protects, and makes future failures harder to diagnose. Module-owned specs provide clearer responsibility and maintainable fixtures.

### Source-flattening-first

Rejected because flattening or broad refactoring production code to reduce branch count changes the shape of the implementation before its behavior is understood. It risks hiding real contracts and can make coverage appear better without improving confidence. Source changes are limited to deleting or simplifying branches proven impossible under enforced invariants; reachable behavior is covered with tests first.

## Self-review checklist

Before considering this design ready for execution, confirm:

- The baseline numbers, file counts, and priority counts are explicit and reconcile (136 total; 99 in the first six; 37 across the remaining 12).
- Every requested behavior boundary and verification command is named without implying that a test-only change can skip build or pre-commit validation.
- The policy distinguishes reachable arms (tests) from impossible arms (source simplification) and forbids coverage-accounting workarounds.
- There are no placeholders, ambiguous ownership instructions, contradictory sequencing rules, or catch-all escape hatches.
- The final result is judged by the actual report: all four metrics at 100%, with the 100% branch threshold enabled only afterward.
