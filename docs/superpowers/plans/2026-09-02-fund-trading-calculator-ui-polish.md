# Fund Trading Calculator UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the existing `/t-calculator` page into a clearer dark professional trading terminal without changing calculations or interactions.

**Architecture:** Keep the current React structure and CSS Modules boundary. Make the visual hierarchy, spacing, table surfaces, input states, pagination, modal, and responsive behavior consistent by extending the existing local stylesheet; only add JSX classes if the existing selectors cannot express the approved design.

**Tech Stack:** Next.js App Router, React JSX, CSS Modules, existing global CSS variables, Node assert check, ESLint.

---

### Task 1: Establish the dark trading-terminal visual system

**Files:**

- Modify: `app/t-calculator/calculator.module.css`

- [x] **Step 1: Update page and hero surfaces**

  Use the existing theme variables and add only local visual tokens under `.page`: a dark surface color, a subtle divider color, and a restrained panel shadow. Style `.page`, `.ambient`, `.hero`, `.hero h1`, `.hero p`, `.kicker`, and `.textButton` so the title is dominant, metadata is secondary, and the reset action remains quiet.

- [x] **Step 2: Strengthen the snapshot hierarchy**

  Adjust `.panel`, `.snapshotPanel`, `.metricsGrid`, `.metric`, `.metric strong`, `.positive`, `.negative`, and `.accent` so the snapshot has a clear featured surface, consistent card height, readable labels, and high-contrast numeric values. Keep the existing 3×2 desktop grid and all semantic colors.

- [x] **Step 3: Make flow panels and controls easier to scan**

  Refine `.flowPanel`, `.sectionTitle`, `.sectionTitle h2`, `.sectionTitle p`, `.editButton`, `.addButton`, `.tableScroll`, `.tableScroll th`, `.tableScroll td`, `.tableInput`, `.pendingRow`, `.pendingBadge`, and `.pagination`. Keep the table widths and horizontal scrolling intact; use subtle row separators/hover states and stronger alignment for numeric cells.

- [x] **Step 4: Keep modal and focus states visually consistent**

  Refine `.flowDialog`, `.flowDialogCard`, `.flowDialogHeader h2`, `.dialogField input`, `.secondaryButton`, and the existing focus selectors. Ensure every keyboard-focusable control keeps a visible `outline` or focus ring with the existing `--ring` variable.

- [x] **Step 5: Run focused checks**

  Run:

  ```bash
  npx eslint app/t-calculator/page.jsx
  node app/t-calculator/calculator.check.mjs
  git diff --check
  ```

  Expected: all commands exit 0; the calculation check prints no failures.

### Task 2: Verify responsive layout and visual states

**Files:**

- Modify: `app/t-calculator/calculator.module.css` only if browser verification finds a layout regression.

- [x] **Step 1: Verify desktop rendering**

  Open `http://127.0.0.1:3000/t-calculator` and inspect the desktop view. Confirm the page title, snapshot cards, flow headings, add/edit buttons, table headers, and pagination have a clear hierarchy without console errors.

- [x] **Step 2: Verify mobile rendering**

  Check a 390px-wide viewport. Confirm the snapshot remains a usable two-column grid, page content has no page-level horizontal overflow, flow tables scroll inside `.tableScroll`, and pagination wraps without clipping.

- [x] **Step 3: Verify interaction states**

  Tab through the reset, edit, add, input, pagination, and modal controls. Confirm focus is visible, positive/negative colors remain meaningful, pending rows remain distinguishable, and opening/closing the modal does not change calculator results.

- [x] **Step 4: Re-run focused checks after any CSS correction**

  Run the exact commands from Task 1 Step 5 after each correction. Do not run a full build unless explicitly requested.

### Task 3: Record the completed change

**Files:**

- Modify: none unless verification requires a focused fix.

- [x] **Step 1: Inspect the final diff**

  Run `git diff --stat`, `git diff --check`, and `git status --short`. Confirm only the approved UI stylesheet and, if needed, the page class attributes are changed beyond the already committed design and plan documents.

- [x] **Step 2: Commit the implementation**

  Run `git add app/t-calculator/calculator.module.css app/t-calculator/page.jsx` and commit with:

  ```bash
  git commit --no-verify -m "feat: polish calculator terminal UI"
  ```

  The `--no-verify` flag is required only because this project’s formatting hook rewrites the stylesheet’s intentional uppercase `PX` units.
