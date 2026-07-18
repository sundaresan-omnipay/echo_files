REQ-524 — How to top the leaderboard (QA role)
Your OPS formula

OPS = DDE×0.30 + DPS×0.20 + CTES×0.20 + VS×0.15 + RS×0.10 + CS×0.05
Ranked by weight — your biggest levers first.

1. DDE — Defect Detection Efficiency (30% of your score — highest weight)

DDE = bugs_caught_in_QA / (bugs_caught_in_QA + bugs_escaped) × 100
Target: ≥ 90%
This is your make-or-break metric. Every bug that escapes to production and gets linked to your sign-off period counts against it. One escaped P1 can tank this heavily because total_bugs is small.
* Run thorough test cycles — don't sign off on releases with untested edge cases
* When you find a bug, raise it as a Jira ticket immediately (so it's caught_in_QA, not escaped)
* Escapes are counted per your "release sign-off period" — know which releases you own

2. DPS — Delivery Predictability (20%)

If 0 days late    → 1.00
If 1 day late     → 0.80
If 1–3 days late  → 0.50
If 3–7 days late  → 0.20
If 7+ days late   → 0.00
Target: ≥ 85%
Only tickets with a due_date field set are scored here — tickets without a due date are excluded (and don't hurt you).
* Check every assigned ticket for a due date
* Prioritize due-date tickets over open-ended ones
* If you know you'll miss a date, flag it early — missing by 1 day (0.80) is vastly better than missing by 4 days (0.20)

3. CTES — Cycle Time Efficiency (20%)
The system measures how fast you complete tickets relative to team median for that SP complexity, in business hours from first "In Progress" to "Done".
* Cycle time starts the moment you click "In Progress" for the first time — don't let tickets sit in your lane
* Don't re-open and re-start tickets; cycle time uses the first "In Progress" transition, so flipping status to reset the clock doesn't work
* Pick up tickets when you have capacity to finish them — avoid starting and then parking

4. VS — Velocity Score (15%)

VS = min((your_SP_per_productive_hour / team_median) × 100, 150)
Productive hours are 7 - deductions + overtime per day, floored at 2. Log your deductions (standups, Loom sessions, handover calls, product reviews) so your productive hours reflect reality — otherwise you're being measured against a 7-hour baseline when you only had 4.5 free hours.
* Log every meeting and async obligation in the deduction form the same day (7-day cutoff — you can't back-date further)
* Overtime (up to +2h/day) boosts your PH and normalises your rate upward

5. RS — Responsiveness Score (10%)

RS_i = min(4 hours / your_response_time, 1.0)
Target: respond within 4 business hours of a ticket being assigned to you. A comment or status change both count — you don't have to fully resolve it, just acknowledge it.
* Check Jira at start of day and after lunch; act on any newly assigned tickets immediately
* Even a "picked up, investigating" comment within 4 hours gives you full RS_i = 1.0

6. CS — Collaboration Score (5%)

CS = min((your_review_actions / team_median_review_actions) × 100, 150)
Counts comments and status transitions on other people's tickets. Team median is the bar; you can get up to 150 (50% above median).
* Comment on dev tickets during your testing cycles — you're already reading them
* Flag anything questionable you notice while reviewing PRs or tickets assigned to others

Anti-gaming rules to know
Rule	What it means for you
Complexity Balance flag	If your median ticket SP falls below 70% of team median, you get a ⚠️ warning visible to leadership. Don't cherry-pick tiny tickets.
Deduction cap	Max 5 hours/day deductions. Don't try to log a full day of meetings — it'll be rejected.
Overtime cap	+2h/day without manager approval flag. Above that, the lead must acknowledge it.
Story points are team-set	You can't inflate SP to game VS — estimates are agreed in sprint planning.

Priority order for maximum OPS
1. Zero escaped production bugs — DDE at 90%+ is non-negotiable at 30% weight
2. Always hit due dates — 1 late ticket at 7+ days = 0 score for that ticket; multiple tickets drag DPS hard
3. Log deductions daily — your VS and CTES are both normalized against productive hours; unclaimed meetings silently hurt your rate
4. Act on assigned tickets within 4 hours — RS is easy to max if you're disciplined about checking Jira
5. Comment on teammates' work — CS is small but free; you're reviewing their work anyway
