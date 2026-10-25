# Onboarding: the new team member

Status: DRAFT, 2026-10-24. Owner: the developer. Approver: Ravi Kiran.

This file gets a new team member from "invited" to "shipping a reviewed change" on Robinson's
General Store's app, and records exactly what access they get and why. The first action is
theirs: fill in the Answer column of the intake form in section 1 and send it back, because
no invite goes out until it is complete.

Evidence tags: `[R path:line]` read from that file and line this session, `[J-open]` believed
but not checked, `[Q: who]` an open question and who answers it. States: BUILT (exists,
evidenced), PARTIAL, SCAFFOLDED, TARGET (not done yet).

## 1. Intake form: what we need from you

Fill in the Answer column. Every invite goes to the address you give for that service, so a
service can be removed later without touching the others.

| # | Question | Answer |
|---|---|---|
| 1 | Full name, as it should appear on invites | |
| 2 | Your GitHub username (create one first if you do not have it) | |
| 3 | Email for the GitHub organization invite | |
| 4 | Email for the Vercel team invite | |
| 5 | Email for the Supabase organization invite | |
| 6 | Email for the Slack workspace invite | |
| 7 | Google account for Drive (only if section 2 says you need Drive) | |
| 8 | Do you have a Claude account? Do you use Claude Code? (yes or no for each) | |
| 9 | Your timezone, and your usual working hours in it | |
| 10 | Laptop operating system and version (macOS, Windows, Linux) | |
| 11 | Node.js installed? Which version? (CI uses Node 20 [R .github/workflows/ci.yml:34]) | |
| 12 | Experience with Next.js App Router: none, some, a lot | |
| 13 | Experience with Supabase and Postgres: none, some, a lot | |
| 14 | Experience with Postgres row-level security (RLS) policies: none, some, a lot | |
| 15 | Experience with GitHub Actions: none, some, a lot | |
| 16 | Is two-factor sign-in turned on for your GitHub account? (yes or no only) | |
| 17 | Start date, and any dates you are away in the first month | |

Open questions for the store, not for you: whether you get a store mailbox at
robinsonsgeneralstore.ca to use for rows 3 to 6, since the plan has 4 of 10 mailboxes free
[R docs/DOMAIN_EMAIL.md:15] [Q: Ravi Kiran]; and who pays for a Claude seat if you need one
[Q: Ravi Kiran].

**Never send us**, in this form, in Slack, in email, in a pull request or anywhere else:

- passwords, for any account, yours or the store's;
- two-factor codes, recovery codes, or your phone number for two-factor recovery. You set up
  two-factor on your own device and keep your own recovery codes;
- API keys, tokens, or connection strings (Anthropic, Supabase, Vercel, Slack, anything);
- card numbers, bank details, or the store's card.

We will never ask for any of these. If a message appears to, treat it as a scam and tell the
store owner. Secret values are never written into the repo either [R docs/HANDOVER.md:169].

## 2. Access we grant you, and why that role and not more

The rule: every account is owned by the store through `admin@robinsonsgeneralstore.ca`, and
people get the smallest role that lets them do their job and can be removed without anything
breaking [R docs/HANDOVER.md:22] [R docs/HANDOVER.md:24]. The store accounts below are
themselves TARGET today: the Supabase organization is on Free and the Vercel project sits on
the developer's personal team [R docs/HANDOVER.md:38] [R docs/HANDOVER.md:39], and the store
GitHub organization does not exist yet [R docs/HANDOVER.md:40]. Until each one moves, any
interim access is the developer's call [Q: the developer].

| Done | Service | Account (from docs/HANDOVER.md "The target") | Your role | Why this role, not more | State | Granted on |
|---|---|---|---|---|---|---|
| [ ] | GitHub | Organization `robinsons-general-store` (fallback `robinsonsgeneralstore`), repository `robinsons-store` [R docs/HANDOVER.md:55] | Organization member, **Write** on `robinsons-store` | Write lets you push branches and open pull requests. Owner or Admin would let you change branch rules, secrets and the automation's limits, which only a person merging should touch [R docs/LOOP_ENGINEERING.md:84] | TARGET | |
| [ ] | Vercel | Team "Robinson's General Store", slug `robinsons-general-store`, project `robinsons-store` [R docs/HANDOVER.md:54] | **Member** | You can read deploys and build logs. Owner controls billing and transfers. Note: Pro is $20 per seat a month, so your seat is a real cost to the store [R docs/HANDOVER.md:54] | TARGET | |
| [ ] | Supabase | Organization `robinsons-store`, project `robinsons-store` (Canada Central) [R docs/HANDOVER.md:53] | **Developer** | Reads the organization and works in the project, cannot change settings or billing [R docs/HANDOVER.md:53]. Schema changes still ship as scripts through a reviewed pull request, not by hand | TARGET | |
| [ ] | Slack | Workspace robinsonsgeneralstore.slack.com [R docs/HANDOVER.md:57] | Workspace **member**, added to the requests channel | The requests channel is where work arrives (section 3.4). It must stay private to the store, because anyone who can type there can ask the bot for work [R docs/SLACK_AUTOPILOT.md:101] | TARGET | |
| [ ] | Google Drive | The store's own Google account, folder `StoreApplication` [R docs/HANDOVER.md:59] [R docs/DATA_SOURCES.md:3] | **Viewer**, only if a task needs the source sheets | Viewer on the shared sheets is the most anyone outside the store gets [R docs/HANDOVER.md:59]. The Lawson "PO Details.docx" there holds a full card number and is due for deletion: do not open, copy or download it [R docs/HANDOVER.md:224] | TARGET | |
| n/a | Anthropic | Console organization "Robinson's General Store" [R docs/HANDOVER.md:56] | **None** | The key lives in Vercel `ANTHROPIC_API_KEY` and the GitHub secret of the same name [R docs/HANDOVER.md:152]. The app and the Slack autopilot use it; you never need to see it | TARGET (by design) | n/a |
| n/a | Password vault | Store vault [R docs/HANDOVER.md:52] | **None** | It holds the store's own logins. You sign in everywhere with your own invite | TARGET (by design) | n/a |
| n/a | Vianet, Resend | Domain, mail, alert email [R docs/HANDOVER.md:51] [R docs/HANDOVER.md:58] | **None** | Owner-only; nothing in your first weeks needs them | TARGET (by design) | n/a |

When you leave, the same table runs in reverse, as in the handover close-out [R docs/HANDOVER.md:220].

## 3. Readiness: your first week

### 3.1 Read, in this order

1. `CLAUDE.md`: the working context and hard rules.
2. `.claude/skills/robinsons-store/SKILL.md`: the invariants and the locked architecture
   [R .claude/skills/robinsons-store/SKILL.md:20]. Then
   `.claude/skills/robinsons-store/references/standards.md`, the house rules for every doc and review
   [R CLAUDE.md:10].
3. `docs/README.md`: which doc answers what.
4. `docs/REQUIREMENTS.md`: every ask and its state. If it is not there, it is not agreed.
5. `docs/STATUS.md`: what is built now.
6. `docs/HANDOVER.md`: who holds each account and the order they move to the store.
7. `docs/AGENTS.md`: the AI agents in the app and in the build loop, and whose key each
   runs on [R docs/AGENTS.md:5]. New this week, so expect it to change.
8. `docs/ENVIRONMENTS.md`: dev and production, and how a change crosses.
9. `docs/LOOP_ENGINEERING.md`: how the automation builds, ships and watches. Read before
   touching `.github/` or `.claude/`.
10. `docs/SUPABASE_SETUP.md`: every SQL script and its run order.

### 3.2 Local setup

- Commands come from `package.json`: `npm run dev`, `npm run build`, `npm run lint`,
  `npm run typecheck` [R package.json:6] [R package.json:10].
- Run it: `npm install`, then `npm run dev` and open http://localhost:3000
  [R CONTRIBUTING.md:6] [R CONTRIBUTING.md:8]. CI installs with `npm ci` [R .github/workflows/ci.yml:36].
- The build must pass with blank env: the app shows a connection card instead of crashing
  [R CONTRIBUTING.md:9]. CI proves it by building with empty Supabase values
  [R .github/workflows/ci.yml:39]. With no database, `/api/health` answers `ok: true` and
  "No database configured" [R src/app/api/health/route.ts:140].
- The three gates, all green before any pull request: `npx tsc --noEmit`, `npm run build`,
  `npm run lint` [R CLAUDE.md:33]. A Claude Code Stop hook also blocks ending a session with
  TypeScript broken [R docs/LOOP_ENGINEERING.md:60].
- Do not put production values in your local env. The dev database is TARGET
  [R docs/HANDOVER.md:42], and production data never copies to anywhere else
  [R docs/ENVIRONMENTS.md:68]. Ask before connecting to any database [Q: the developer].

### 3.3 Standing invariants (never regress these)

Copied from docs/REQUIREMENTS.md [R docs/REQUIREMENTS.md:41]:

1. Every read and write is store-scoped; new tables get store_id, RLS, and a line in
   auth_setup.sql section 3a (section 3e and supabase/money_by_role.sql if the table holds a
   dollar figure).
2. Money visibility fails closed: null/unknown role sees no dollars (canSeeMoney).
3. Editing is role-gated (canEdit); destructive actions are soft voids (voidRow /
   void_payment) filtered with .is("voided_at", null); user-facing label is Void.
4. Payments flow ONLY through the engine RPCs: record_payment, void_payment, edit_payment,
   reconcile_postdated. Post-dated = cheque with a future paid date, never a method.
5. activity_log rows only with a known actor (currentActorId); guarded inserts.
6. A human confirms anything that moves dollars (discrepancy and low-confidence gates).
7. The app builds with blank env (no crash, clear connection cards).
8. Calm neutral canvas; color carries status meaning only. AI answers are plain text.

### 3.4 How work arrives and how it ships

- **Arrives (BUILT):** a message in the Slack requests channel that names the bot comes back
  within about half an hour as a draft pull request, with a reply in its thread
  [R docs/SLACK_AUTOPILOT.md:3] [R docs/SLACK_AUTOPILOT.md:78]. It never merges, and it
  refuses payments, auth and RLS work, which comes to a person [R docs/SLACK_AUTOPILOT.md:97].
  Read docs/SLACK_AUTOPILOT.md for the reaction and status-card meanings.
- **Ships (BUILT):** a script reads each diff and sets its tier. A: words only, merges itself.
  B: the default, a person merges. C: money, access, the database or the automation, nothing
  merges [R docs/LOOP_ENGINEERING.md:74].
- **Dev then production (SCAFFOLDED):** the design is `develop` to a dev site and dummy
  database, `main` to production [R docs/ENVIRONMENTS.md:17]. The workflows exist but stay
  inert until a `develop` branch and `SUPABASE_DB_URL_DEV` exist [R docs/ENVIRONMENTS.md:105],
  so today changes go to `main`.
- **Watched (BUILT):** "Post-deploy watch" runs after CI on `main` and every two hours, and
  asks the live site `/api/health` [R .github/workflows/post-deploy-watch.yml:17]
  [R .github/workflows/post-deploy-watch.yml:22]. Until `PRODUCTION_URL` is set it checks the
  vercel.app address [R .github/workflows/post-deploy-watch.yml:54].

### 3.5 What you inherit: open owner decisions and open items

Summarised from the OPEN section of docs/REQUIREMENTS.md [R docs/REQUIREMENTS.md:160] and the
open items in docs/HANDOVER.md [R docs/HANDOVER.md:227]. Read the source before acting, because
that section warns its lines go stale [R docs/REQUIREMENTS.md:180].

| Item | Waiting on | Blocks |
|---|---|---|
| Move every account to the store (HANDOVER steps 0 to 6) | Ravi Kiran for sign-ups and card; the developer for transfers | Closes both platform risks: Vercel Hobby is not licensed for commercial use, Supabase Free takes no backups [R docs/PLATFORM.md:25] [R docs/PLATFORM.md:46] |
| Domain renewal not seen, due 2026-10-16 (HO-01) | Ravi Kiran | Anything on the domain |
| Which password vault (HO-02) | Ravi Kiran | Handover step 0 |
| Anthropic monthly spend limit (HO-03) | Ravi Kiran | Nothing |
| Who is Slack Primary Owner today (HO-04) | The developer | Nothing yet |
| The store Google account's address (HO-05) | Ravi Kiran | Nothing yet |
| A second store-controlled GitHub owner (HO-06) | Ravi Kiran | Close-out |
| Handover commits on a branch not yet pushed (HO-07) | The developer | Nothing |
| Allow GitHub Actions to create pull requests | Repository admin | The promotion workflow |
| Minimum order: ask on every edit (A) or only where shown (B, built) | Ravi Kiran | Nothing |
| "Not answered yet" view for vendor fields | Ravi Kiran | Nothing |
| The 12:18 voice note, "deposit on the device" | Ravi Kiran | Nothing |
| Domain panel: repoint the stories@ alias, retire an old mailbox, create invoices@ | Ravi Kiran | Email invoice intake |
| Upload Departments&WorkFlow.xlsx | Ravi Kiran | Payment-record field check |
| Delete the Lawson PO doc with the card number | Ravi Kiran | Standing reminder |
| Rotate the owner's demo password; Resend and cron env if wanted | Ravi Kiran | Daily email |

### 3.6 Day 1 proof

You are ready when each of these is true, checked by you, not assumed:

- [ ] Signed in to GitHub, Vercel, Supabase and Slack, each with your own invite and two-factor on.
- [ ] Cloned `robinsons-store` and ran `npm install`.
- [ ] `npm run build` passes with no env file at all.
- [ ] `npx tsc --noEmit`, `npm run build` and `npm run lint` all pass.
- [ ] Opened the latest "Post-deploy watch" run under Actions [R .github/workflows/post-deploy-watch.yml:1]
      and can say whether `/api/health` answered healthy, and which address it checked.
- [ ] Can name the tier your first change would get, and who merges it.

## 4. Who to ask

- **Store owner, Ravi Kiran:** business decisions, anything in section 3.5 marked for him,
  and anything that needs the store card or the admin@ mailbox.
- **The outgoing developer:** history, why something is built the way it is, and interim
  access, until the handover close-out [R docs/HANDOVER.md:218].
- **The repo itself:** the docs index first, then `git log` on the file in question.

Ask in the Slack workspace, not in direct messages to personal accounts, so the answer stays
with the store.

## How this maps to the rest of the docs

Accounts, roles and the secrets register: [docs/HANDOVER.md](docs/HANDOVER.md). Why the store
owns every account: [ADR-001](docs/adr/ADR-001-the-store-owns-every-account.md). Services and
plans: [docs/PLATFORM.md](docs/PLATFORM.md). The agents and their keys:
[docs/AGENTS.md](docs/AGENTS.md). Environments: [docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md).
Automation: [docs/LOOP_ENGINEERING.md](docs/LOOP_ENGINEERING.md) and
[docs/SLACK_AUTOPILOT.md](docs/SLACK_AUTOPILOT.md). Everything else:
[docs/README.md](docs/README.md).

**Basis: 55 claims checked this session (2026-10-24), 55 confirmed, 0 killed, 16 sources.**
Files opened: CLAUDE.md, docs/AGENTS.md, package.json, CONTRIBUTING.md, RUNBOOK.md, docs/HANDOVER.md,
docs/REQUIREMENTS.md, docs/README.md, docs/ENVIRONMENTS.md, docs/LOOP_ENGINEERING.md,
docs/SLACK_AUTOPILOT.md, docs/PLATFORM.md, docs/DATA_SOURCES.md, docs/DOMAIN_EMAIL.md,
docs/STATUS.md, docs/SUPABASE_SETUP.md, .claude/skills/robinsons-store/SKILL.md,
.github/workflows/ci.yml, .github/workflows/post-deploy-watch.yml and
src/app/api/health/route.ts.
