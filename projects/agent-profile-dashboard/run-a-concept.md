# Run A — Concept

Paper design for the Agent Profile Dashboard redesign. Answers the seven plan questions plus the three additional items. No code.

Grounded in:
- Brief (`brief.md`) and rubric (`rubric.md`) at baseline `0f5895e4`.
- Discovery (`run-a-discovery.md`) — particularly the data-model facts about `AgentTaskSession`, `runtimeState`, `budgetOverview`, and the lack of a reorder endpoint.
- Operating principles (`operating-principles.md`) — cited by name where they drove a call.

---

## The shape of the redesign

Two-zone hero band, one merged chart, one in-flight-tasks list, one unified costs module. Four elements stacked vertically; the hero is the load-bearing one.

```
┌── Hero band ───────────────────────────────────────────────────────────────┐
│  [Left zone — "what's happening now"]     │  [Right zone — "how are we"]   │
│  Activity state  •  Current work card     │  Budget position               │
│                                           │  Recent runs (7 dots)          │
└────────────────────────────────────────────────────────────────────────────┘
┌── Activity over time ──────────────────────────────────────────────────────┐
│  14-day run activity + success rate (merged)                               │
└────────────────────────────────────────────────────────────────────────────┘
┌── In-flight tasks ─────────────────────────────────────────────────────────┐
│  Up to 7 rows. Each row: priority icon (clickable) + title + status + link │
└────────────────────────────────────────────────────────────────────────────┘
┌── Costs ───────────────────────────────────────────────────────────────────┐
│  Totals strip (token + cost) → per-run table (date, run, tokens, cost)     │
└────────────────────────────────────────────────────────────────────────────┘
```

Hero is the monitoring frame. Everything below is for secondary modes.

---

## 1. Hero frame — two-zone split

Of the three candidates from the plan (dense horizontal strip, morphing single card, left/right split), I'm committing to the **left/right split** ("now" | "how are we doing"). Rough widths on 1440px minus left-rail chrome (~220–240px): content width ~1180–1200px, split 55/45 for left/right — ~650px / ~530px. Both zones sit in one `rounded-none` bordered container or two adjacent bordered containers (decision in Phase 3a).

**Why this over the alternatives:**

- **Single dense horizontal strip:** would squeeze four signals into one horizontal band. Violates *Miller's Law* the moment we add any secondary metadata (e.g., current task title, budget amount label) — forces the user to parse four distinct cells horizontally with poor visual distance between them.
- **Morphing single card:** elegant but pays a heavy *Mental Models* tax — user has to learn that the same card means different things in different states. Also concentrates all four Section-1 signals in one card, which makes layout brittle.
- **Two-zone split:** applies *Common Region* (Gestalt) cleanly — "now" and "how we're doing" are cognitively separate questions. Gives each zone room for secondary metadata. Degrades gracefully on narrower viewports (zones can stack). F-pattern scanning lands eyes on the top-left first (activity state + current work), which is the most time-sensitive information.

**Left zone (~650px):**
- Activity state — a compact row with the agent's state: `● Running` (cyan pulse), `○ Idle`, `⏸ Paused`, `⚠ Error`. Lives as a pill at the top of the zone. Uses `agent.status` as the source; see §6 for signal treatment.
- Current work — a one-line summary directly under activity state: "On `SKI-142`: Add budget alerts to sidebar" when live; "Last run: `SKI-139` succeeded 2h ago" when idle. Preserves the `Link` navigation from current `LatestRunCard`. Dense, one line; the multi-line `resultJson.summary` excerpt moves into an optional expandable.

**Idle-state attention point for Phase 3a:** the idle treatment as written ("Last run: SKI-139 succeeded 2h ago") answers "what just happened" but not "what's supposed to happen next." A monitoring user checking in on an idle agent may benefit from a small forward-looking signal such as "Next scheduled run in 12m," "Awaiting assignment," or "No pending work." Phase 3a should consider whether to add this and what data drives it (heartbeat schedule interval, queued wakeups, assigned-but-untouched issues). Not a redesign change at the concept level — a polish decision for the module pass.

**Right zone (~530px):**
- Budget position block (see §3).
- Recent runs strip (see §7).

---

## 2. Chart consolidation — from four to one

**Survivors:** one chart — **Run Activity (merged with Success Rate)**. Stacked succeeded / failed / other bars per day, 14 days, with success-rate percentage rendered as a **subtitle** ("78% success · last 14 days"). Uses existing `RunActivityChart` data shape, just gets a success-rate caption added. Subtitle over line-overlay: line overlay reintroduces competing axes (count vs. percentage) in the same chart, which is the visual complexity the 4-to-1 consolidation is trying to remove. Subtitle keeps the chart single-axis and the success-rate signal still visible at a glance.

**Dropped and why each is safe:**
- **Issues by Priority** — duplicates the `/issues?participantAgentId=...&priority=...` filter view. One click from the dashboard (via the existing "See All →" link on the in-flight-tasks list) reaches the canonical home for this data. Reachable within 1 interaction.
- **Issues by Status** — same logic as Priority. The Issues list is the canonical home. Dashboard isn't the right place for issue-breakdown charts when the Issues list can answer the same question with filtering.
- **Success Rate as its own chart** — a single number derived from the same `runs` array that feeds Run Activity. Folds into Run Activity as a caption. No information loss.

**What's uniquely dashboard-shaped:** temporal run activity. Every other chart duplicated a view that lives elsewhere. Following *Information Scent* principle and the brief's direction ("charts earn their place"): one chart that does its own job, not four that duplicate other surfaces.

**Reachability check against rubric Section 4:**
- Priority / Status data reachable within 2 interactions: ✓ (one click to Issues list, one filter click). Both ≤2.
- Run Activity + Success Rate data visible on-dashboard: ✓ (the one surviving chart).

---

## 3. Budget position — compact inline card

**Shape:** horizontal progress bar with stacked metadata. Specifically, a 4-line compact block:

```
Budget — this month
$142.50 of $500.00                          29%
▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
$357.50 remaining · resets in 11 days
```

- Line 1: small label (`text-xs text-muted-foreground`).
- Line 2: `observedAmount / amount` in `tabular-nums`, utilization % right-aligned.
- Line 3: progress bar — fills using existing `BudgetPolicyCard` color logic (`--signal-success` when OK, severity-appropriate tone for warn/hard_stop).
- Line 4: remaining amount + window end.

**Why this shape, not alternatives:**
- Pure utilization % — too abstract, doesn't answer "how much do I have left" without mental arithmetic.
- `$X / $Y` alone — readable but loses the "how close to the ceiling" spatial signal that a progress bar gives.
- Combined — single glance answers three questions (how much used, how much total, proportion).

**Reuse vs. inline:** concept says *inline variant* of `BudgetPolicyCard`'s visual treatment — sized for a hero zone, not a full-page card. Same color logic, same token set. No new tokens. *Reach for what exists first* (operating principles): use the existing `agentBudgetSummary` shape directly, thread it into `AgentOverview` as discovered in §5 of discovery.

---

## 4. Change-priority affordance — explicit selector

**Decision:** explicit priority selector per row. Not drag.

**Specifically:** each in-flight-tasks row has a priority icon (existing `PriorityIcon` component) on the left, acting as a button. Click opens a popover with the 4 priority options (`critical | high | medium | low`). Pick one, popover closes, row updates optimistically. Uses `issuesApi.update(id, { priority })`.

**Why selector over drag:**
- **Fitts's Law** — click-target 16×16 is faster than a drag gesture across four buckets. Priority change is a frequent, low-stakes operation; should be cheap.
- **Hick's Law** — 4 discrete choices are equivalent whether presented as drag targets or popover items. Popover is more compact.
- **Vertical space cost** — drag-to-bucket requires a 4-column Kanban layout, eating ~250px vertically before any tasks are shown. That breaks the monitoring-no-scroll goal. The dashboard is about information density; the priority affordance must not compete with that.
- **Keyboard accessibility out of the box** — popover with 4 `<button>` items is keyboard-navigable without the `@dnd-kit` keyboard-sensor layer. Satisfies rubric Section 3 ("drag-and-drop or keyboard-reorderable") cleanly.
- **Precedent isn't free** — `KanbanBoard.tsx` uses drag for *status* changes across 7 columns where the visual metaphor (columns = states) is strong. Priority doesn't have the same spatial metaphor; priority is a ranking, not a location. Drag would be notation theater.

**Interaction detail** — after selection, the row may jump positions (sort is priority-then-updatedAt; see §Additional 1). The motion is the feedback. Optimistic update means <400ms perceived latency (*Doherty Threshold*).

**Flagged for run-notes:** drag was considered and rejected for vertical-space cost. If your intent in the brief was *specifically* to force a drag exploration, the selector is not what you asked for — but the rubric admits either, so this is an intent-vs-implementation call I'm making.

---

## 5. Session burn rate — inside the costs module, not as a rate

**Placement:** inside the unified costs module (below in-flight tasks), next to the existing totals strip. Not in the hero.

**What "burn rate" actually means here:** reading the brief carefully, it says "recent cost activity against the current session (cumulative cost and per-run cost over the recent window)." That's not rate — that's two concrete signals:

1. **Cumulative session cost** — from `runtimeState.totalCostCents` + token totals (input, output, cached). Today's KPI strip already shows this. Keep as-is.
2. **Per-run cost over recent window** — from the heartbeats array, filtered to recent runs with nonzero cost. Today's cost table already shows this. Keep as-is.

The redesign's job here is *merging* them into one coherent surface, not adding a new "rate" concept. Proposed layout:

```
Costs — session
$1.42 cumulative  ·  142k in  ·  38k out  ·  12k cached

Recent runs with cost
Date        Run        Input     Output    Cost
…
```

Totals strip collapses to a single line under a small heading; per-run table sits directly below. One visual region, two complementary signals.

**Flagged for run-notes:** the brief's phrasing is ambiguous between "rate" and "two signals." I'm interpreting as the latter because that's what the data actually supports without adding synthesis. If you wanted a rate (e.g., "$0.12/minute for the last hour"), I'd need to derive it from per-run `startedAt`/`finishedAt`/`cost` — doable but additive. Flagging for your call.

---

## 6. Live-run signal — cyan relocated, not cyan preserved

**Decision:** keep cyan as the live-agent color, but relocate it from card-level (glow + border tint) to pill-level (activity-state pill at hero top-left).

**What changes specifically:**
- **Activity state pill** — when `agent.status === "running"`, the pill reads `● Running` with a cyan pulse dot, cyan text. Uses existing `agentStatusDot` from `status-colors.ts` (no new tokens).
- **Current-work card** — no cyan border, no cyan glow. Plain `border-border rounded-none` container. Inside, the existing `StatusIcon` (cyan spinning `Loader2` when status is `running`) still appears — it sits next to the run id, providing the card-local running signal without the full-card chromatic treatment.

**Why this is better than cyan-preserved-as-is:**
- Hero is denser. Budget progress bar could use `--signal-success` (green), status badges on rows have color, recent-health dots are multi-colored. Adding a cyan-glow card on top of that creates chromatic competition — the eye can't tell which colored element is the primary signal. *Von Restorff* only works when the isolated element is alone.
- The activity-state pill is higher-signal per-pixel: one small dot at top-left says "the agent is alive right now" with less visual mass than a full-width cyan glow.
- Preserves the app's existing cyan = liveness vocabulary (workspace-ops, header mobile indicator) without duplicating it in two places within the dashboard.

**Rubric Section 5 "live-run visual distinction" passes** because cyan is preserved as the color; the location is just different. The distinction between live and non-live is visible (pulse dot vs. no pulse; different activity pill text).

---

## 7. Recent health — 7 clickable dots

**Decisions:**
- **Count:** 7 runs. Comfortable within *Miller's Law* (7±2), visually scannable, roughly one week for an active agent.
- **Visual treatment:** colored status dots, inline horizontal strip, oldest → newest left to right. Colors from existing `status-colors.ts` entries (green = succeeded, red = failed, cyan = running, yellow = queued, neutral = cancelled/other). Per *WCAG color-independence*, each dot also has a distinct symbol on hover/focus (using lucide icons — `CheckCircle2`, `XCircle`, etc.), so colorblind users can still parse.
- **Interactivity:** each dot is a `<Link>` to that run's detail (`/agents/[agent]/runs/[runId]`). Hover/focus shows a tooltip with run id, outcome, and `relativeTime` — pulls from existing `runStatusIcons` + `sourceLabels` maps.
- **Duration:** not shown. Too compact for duration metadata. Duration lives in the costs table below.

**Position:** right zone of hero, directly under the budget card. Small label "Recent runs — last 7" above the dot strip.

---

## Additional 1 — "In-flight tasks" definition

**Filter:** issues where `assigneeAgentId === agent.id` AND `status ∈ {todo, in_progress, blocked}`. Excludes `backlog` (not yet committed to work), `in_review` (handed off), `done`, `cancelled`.

**Sort:** `priority` descending (critical → low), then `updatedAt` descending within each priority bucket. Ties broken by `createdAt`.

**Limit:** 7 rows visible by default. Matches Recent-health count for visual rhythm. A "View all (N) →" link navigates to `/issues?participantAgentId=...` for the full list, satisfying *Progressive Disclosure*.

**UX implication, intended:** when a user changes priority on a row, the row repositions according to the new sort. This is feedback — the repositioning confirms the action. Without it, the action is inert. Flagging as intended behavior in run-notes.

---

## Additional 2 — Per-mode serving check

| Mode | Served by | Crowding risk |
|---|---|---|
| Monitoring (primary) | Hero band: 4 Section-1 items without scroll | none — hero is the whole monitoring surface |
| Operations (secondary) | In-flight tasks list + priority-icon popover | none — list sits below hero, no visual competition |
| Accountability — spend | Budget in hero (position) + costs module (breakdown) | ⚠ see §6 of discovery: per-*task* spend isn't easy. `HeartbeatRun` has no `issueId` link. Can surface per-*run* cost in the table; per-task rollup would require joining runs → issues via `run.contextSnapshot` or similar, which is beyond the rubric's asks. Flagging, not blocking. |
| Accountability — tokens | Costs module token totals + per-run breakdown | none |
| Debug | Recent-health dots (1-click to failed run) + costs table (timestamps + per-run) | ⚠ rubric Section 2 Debug: "identify failed *tasks*, see when each one failed." Failed *runs* ≠ failed tasks per se. Close-enough for this dashboard since a task that failed to run is represented by its failed run; but flagging the terminology gap in run-notes. |

---

## Additional 3 — Operating principles cited

Decisions grouped by the lens that drove them:

- **Prägnanz / Common Region** — two-zone hero splits "now" vs "how are we doing" (§1).
- **Miller's Law (7±2)** — 7 recent runs, 7 in-flight tasks max (§7, §Additional 1).
- **F-pattern scanning** — activity state top-left where eyes land first (§1).
- **Serial Position** — hero → chart → tasks → costs in order of monitoring > operations > accountability (§Shape).
- **Fitts's Law + Hick's Law** — explicit selector over drag (§4).
- **Von Restorff** — cyan pill is the isolated chromatic signal, not competing with cyan glow elsewhere (§6).
- **Doherty Threshold (<400ms)** — optimistic update on priority change (§4).
- **Progressive Disclosure** — "View all →" link for task overflow; per-run detail hidden behind run-detail navigation (§Additional 1, §7).
- **Recognition over Recall** — reuse `PriorityIcon`, `StatusIcon`, `BudgetPolicyCard` styling; users already know these glyphs (§3, §4, §7).
- **WCAG POUR / color-independence** — status dots and priority glyphs use shape + color, not color alone (§7).
- **Information Scent** — dropped charts are reachable via clear scent (the `/issues` filters) within 1 click (§2).
- **Reach for what exists first** (operating principles "DS-first discipline") — zero new components, zero new tokens; reuse `agentBudgetSummary`, `PriorityIcon`, `StatusBadge`, existing `issuesApi.update`, existing `@dnd-kit` not-used, existing `runStatusIcons` map (§3, §4, §5, §7).
- **Postel's Law** — handle gracefully the zero-runs, zero-issues, no-budget-policy, and paused-agent states; each element has a defined empty treatment (§7, Phase 3a).

---

## What this concept is not deciding

Explicitly out-of-scope for this concept, per brief and operating principles:
- Component extraction (`AgentOverview` etc. stay inline in `AgentDetail.tsx`).
- Chart token introduction (Run Activity keeps hardcoded hex).
- Status-color changes (`status-colors.ts` untouched).
- New tokens (no `--signal-warning`, no chart tokens, nothing else).
- Pause/terminate controls (pause is in page chrome, not duplicated; terminate is out of scope).
- Other profile tabs.

---

## Findings surfaced (not decisions to pursue here)

These are things the design work surfaced that aren't mine to fix in this experiment. Noting for the post-experiment decision pile.

1. **Per-task cost attribution is weak** — `HeartbeatRun.contextSnapshot` may or may not carry an issue link reliably. A real spend-per-task view would need a first-class linkage.
2. **Header/dashboard cyan hue drift** (header uses `bg-blue-*`, inline card uses `bg-cyan-*`) — out of scope for Run A; would be a 1-line fix in the header outside the redesign region.
3. **`--signal-warning` is still missing** — budget warn-state will use whatever `BudgetPolicyCard` already does (probably raw-palette amber). Flagging in run-notes per the rubric's "pass with explicit justification" mechanic; not fixing.
4. **"Failed task" vs "failed run" terminology gap** (rubric Section 2 Debug) — not a redesign decision; a brief-terminology decision for a future iteration.

---

## Summary

A two-zone hero carries the monitoring frame. Below it, one merged chart keeps the temporal signal without duplicating other surfaces. An in-flight-tasks list with an explicit priority selector serves operations mode without eating vertical space. A unified costs module serves both accountability modes. Cyan is preserved but relocated to the activity-state pill, not the card border. Seven clickable recent-run dots give 1-click access to debug-mode investigation.

Three interpretations I'm making that deserve your pushback before Phase 2:
1. Selector over drag (§4).
2. "Burn rate" as two complementary signals, not a rate (§5).
3. Sort-induced repositioning on priority change as feedback, not disruption (§Additional 1).

Waiting on your read.
