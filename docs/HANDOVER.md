# Handover: moving every account to the store

**The store owns its domain already. Everything else the app runs on (hosting, database,
code, AI key, Slack app) still sits on accounts the developer opened, and two of them are on
plans that put the store at risk. This file is the register of what exists, the order to move
it in, and the checks that prove the move worked.** Prepared 2026-10-18 from live reads of
Vercel, Supabase and GitHub, not from older docs.

Companion files: docs/PLATFORM.md (every service and why), docs/ENVIRONMENTS.md (dev and
production), docs/SUPABASE_SETUP.md (the database scripts and the connection secret),
docs/DOMAIN_EMAIL.md (the domain and mailboxes), RUNBOOK.md (first-time setup and the login
cutover).

## The rule this follows

Every account is opened with a **store mailbox**, paid with the **store's card**, and owned
by the store's company (1000476363 ONTARIO INC., the name already on the Vianet account). The
developer is then a member with the smallest role that still lets the work happen, and can be
removed without anything breaking. A person's own email as the login for a store service is
the thing being removed: if that person leaves, the store cannot recover the account.

## What exists today, read 2026-10-18

| Service | What is there | Plan | Who holds it | Risk |
|---|---|---|---|---|
| **Vianet** | Domain robinsonsgeneralstore.ca, 5 of 10 mailboxes, store internet | About $10 a month | **The store** (1000476363 ONTARIO INC.) | Domain was due to renew 2026-10-16. Auto-renew was confirmed on; the renewal itself is not verified, see Step 1 |
| **Vercel** | Project `robinsons-store`, serving app.robinsonsgeneralstore.ca and robinsons-store.vercel.app. Last production deploy 2026-09-01, Ready. Vercel login protection on every address except the custom domain | **Hobby** | The developer's personal Hobby team | **Hobby does not license commercial use** (PLATFORM.md risk 1) |
| **Supabase** | Organization `robinsons-store`, one project `robinsons-store`, Canada Central (Toronto), Postgres 17, healthy | **Free, confirmed 2026-10-18** | Opened by the developer | **No backups of any kind** (PLATFORM.md risk 2) |
| **GitHub** | The repository, eleven Actions workflows, every deploy and migration secret | Free | The developer's personal account | Secrets are only readable by the account that holds the repo |
| **Anthropic** | One API key, used by the app and by the Slack autopilot | Pay as you go, about $5 to $40 a month | Opened by the developer | The store's invoices pass through a key it does not control |
| **Slack** | A bot app made from docs/slack-app-manifest.yml and an incoming webhook for the watchdog | Free | Whoever created the app | Bot token and webhook die with the app |
| **Resend** | Not set up. The daily due-date email is off | Free tier when used | Nobody | None yet; set it up under the store from the start |
| **AgentMail** | Installed from the Vercel Marketplace 2026-08-12, not wired in | Free tier | The developer's Vercel team | Marketplace installs do not move with a project |
| **Google Drive** | The store's own sheets and documents | Store's Google account | **The store** | The Lawson "PO Details.docx" still holds a full card number in plain text |
| **Jira** | Switched off 2026-08-12, autopilot parked | None | Nothing to move | If it comes back, open it under the store |

Login state, read from the live database the same day: the per-store, per-role policies from
`auth_setup.sql` are in place (21 locked policies, no open demo policies left), the `documents`
bucket is private, and **one** login account exists. Staff logins still have to be created,
from the app's Team page once `SUPABASE_SERVICE_ROLE_KEY` is set.

## What it will cost after the move

| Service | Monthly | Why it changes |
|---|---|---|
| Vercel Pro | $20 per seat | Required for commercial use. One seat for the store; a second only if the developer stays a member |
| Supabase Pro | $25 | Daily backups, last 7 days. The store's ledger has six-year record-keeping obligations |
| Anthropic | $5 to $40 by volume | Same as today, on the store's card |
| Vianet | About $10 | Unchanged |
| GitHub, Slack, Resend | $0 | Free tiers cover this |

About $60 to $95 a month, inside the $50 to $100 the build spec planned for and well under
its $200 ceiling.

## The order, and why it is this order

Foundations first, because every later step needs the store mailbox to sign up with. The
database before the hosting, because backups protect the one thing that cannot be rebuilt.
Hosting and code together, because moving either one breaks the link between them until both
have moved. The dev environment last and straight onto the store's accounts, so it never
becomes one more thing to transfer.

### Step 0. Foundations (owner, about 30 minutes)

1. **Create a store admin mailbox** on Vianet, for example `admin@robinsonsgeneralstore.ca`.
   Five of the ten mailboxes are free. Every account below signs up with this address, never
   with a person's own email.
2. **Pick one password manager the store owns** and put every login, recovery code and API
   key from this file in it. The developer never needs to see the store's passwords after
   this; keys go straight from the service into Vercel or GitHub.
3. **Turn on two-factor sign-in** on each account as it is created, with the recovery codes
   saved in the password manager. A lost phone should not lose the store its hosting.

### Step 1. The domain (owner, 5 minutes)

The store already owns it. Two checks:

1. Vianet panel (https://myaccount.vianet.ca/): confirm the **2026-10-16 renewal went
   through** and note the new expiry date in docs/DOMAIN_EMAIL.md. Nothing in this repository
   could verify it: the watchdog may be checking the vercel.app address, which would keep
   passing even if the domain lapsed.
2. Make `admin@` the account's contact address.

Then set the GitHub variable `PRODUCTION_URL` to `https://app.robinsonsgeneralstore.ca`, so
the watchdog checks the address the owner actually uses and a lapsed domain shows up as a
failed check instead of nothing.

### Step 2. Supabase: change who owns it, then turn on backups (owner and developer, 15 minutes)

Keep the existing organization. It is already named for the store, and keeping it means no
connection string changes and nothing to redeploy.

1. The developer invites `admin@` to the organization as **Owner** (Organization settings,
   Team).
2. The store, signed in as `admin@`, puts the **store's card** on the organization and
   upgrades it to **Pro**. Daily backups start the next day.
3. Change the developer's role to **Developer**, or remove them at close-out.
4. Reset the database password (Project settings, Database). Nothing in the app reads it, so
   this cannot break the site. Rebuild `SUPABASE_DB_URL` from the new password exactly as
   docs/SUPABASE_SETUP.md describes (session pooler, port 5432) and replace the GitHub secret.

Until Pro is on, run the app's Export screen and save the workbook to the store's Google
Drive. It is a record, not a restore path: it leaves out the uploaded invoice images.

### Step 3. Vercel: a store team on Pro, then move the project (owner and developer, 20 minutes)

1. Signed in as `admin@`, create a Vercel **team** and choose **Pro**, on the store's card.
2. The developer opens the project, Settings, General, **Transfer Project**, and sends it to
   the store's team. The project keeps its deployments, environment variables and domains,
   so the site keeps serving through the move.
3. Things that do **not** move, and what to do about each:
   - **AgentMail** (a Marketplace install) stays behind. Uninstall it from the old team and
     install it on the store's team when email intake is actually built.
   - **`VERCEL_TOKEN`** in GitHub belongs to the developer's account. Create a new token from
     the store's account (Account settings, Tokens), scoped to the store's team, and replace
     the GitHub secret. Used by `vercel-diagnose.yml` and `vercel-protect.yml`.
4. Check, in the store team's copy of the project: Settings, Functions, Function Region is
   still **Montreal (yul1)**, and Settings, Cron Jobs lists the daily `/api/alerts` run.

On Pro, Vercel can refuse to build a commit whose author is not a member of the team. If a
deploy shows as blocked after the move, that is the cause: add whoever merges pull requests
as a member.

### Step 4. GitHub: the code into a store organization (owner and developer, 15 minutes)

1. Signed in as `admin@`, create a free GitHub **organization** for the store.
2. The developer transfers the repository to it (repository Settings, General, Danger Zone,
   Transfer). Old links and git remotes redirect on their own.
3. Re-check every secret and variable in the register below against the repository's
   Settings, Secrets and variables, **Actions**. Re-add anything missing. A missing secret
   does not fail a run: the workflow reports `skipped` and goes green, which looks exactly
   like nothing needing doing.
4. Reconnect Vercel to the new location: the store's Vercel project, Settings, Git, install
   the Vercel GitHub app on the store's organization and point the project at the moved
   repository. Merge any small change and confirm a production deploy appears.
5. If changes will keep being built with Claude, install the Claude GitHub app on the store's
   organization so new sessions can reach the moved repository.
6. Add the developer as an outside collaborator with **Write** while work continues.
7. Settings, Actions, General, Workflow permissions: allow GitHub Actions to create and
   approve pull requests. The promotion workflow needs it to open the develop to main pull
   request; merging stays human either way.

### Step 5. Reissue the keys under the store (owner, 20 minutes)

| Key | Where to get it as the store | Where it goes | Then |
|---|---|---|---|
| Anthropic | console.anthropic.com as `admin@`, store card, set a monthly spend limit, Create Key | Vercel `ANTHROPIC_API_KEY` (production and preview) and GitHub secret `ANTHROPIC_API_KEY` | Redeploy, test one capture, then revoke the old key |
| Slack bot and webhook | api.slack.com/apps: add `admin@` as a collaborator on the existing app, or make a fresh app from `docs/slack-app-manifest.yml` in the store's workspace | GitHub secrets `SLACK_BOT_TOKEN` and `SLACK_WEBHOOK_URL`, variable `SLACK_REQUEST_CHANNEL` | Actions, "Say something in Slack", run it once |
| Resend (new) | resend.com as `admin@`, verify robinsonsgeneralstore.ca | Vercel `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO` | Vianet has no self-serve DNS editor, so the verification records are a phone call to Vianet hosting (docs/DOMAIN_EMAIL.md) |
| `CRON_SECRET` | Make a new long random string | Vercel **and** GitHub, the same value in both | The watchdog and the daily email both send it |
| Supabase service role | Supabase, Project settings, API | Vercel `SUPABASE_SERVICE_ROLE_KEY` | Turns on the Team page so staff logins can be made in the app |

### Step 6. The dev environment, built on the store's accounts (developer, 30 minutes)

Do this after Steps 2 to 4 so nothing new is created on the developer's accounts. The steps
are in docs/ENVIRONMENTS.md, Setting it up. Two adjustments for the store's accounts:

- Put the dev database in a **second, Free organization** owned by `admin@`, not in the Pro
  one. A second project inside a Pro organization adds compute charges; a Free organization
  allows two projects at no cost. A Free project pauses after a week with no activity and is
  restored from the dashboard in a minute, which is fine for a practice site.
- The guard from 2026-09-01 (`.github/scripts/distinct-databases.mjs`) refuses to run any dev
  script if `SUPABASE_DB_URL_DEV` points at the same project as production, so a pasted
  string in the wrong box stops the run instead of writing invented vendors into the store's
  ledger.

Then create the `develop` branch. Until it exists every other dev piece stays switched off.

## Secrets and variables register

Every name the code and workflows read, from a search of `src/` and `.github/workflows/` on
2026-10-18. Values are never written here.

**Vercel, project environment variables**

| Name | Issued by | Notes | Rotate if the developer leaves |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase | Public by design | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase | Public by design; the database policies are what protect the data | No |
| `NEXT_PUBLIC_REQUIRE_AUTH` | Set by hand | `true` once login is enforced; the database side is already enforced | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Server only. Bypasses the policies: guard it most | **Yes** |
| `ANTHROPIC_API_KEY` | Anthropic | Also a GitHub secret | **Yes** |
| `ANTHROPIC_MODEL` | Set by hand | Optional, defaults to claude-sonnet-5 | No |
| `CRON_SECRET` | Made up | Same value as the GitHub secret | **Yes** |
| `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO` | Resend, set by hand | Only when the daily email is wanted | Key only |

**GitHub, Actions repository secrets**

| Name | Used by | Rotate if the developer leaves |
|---|---|---|
| `SUPABASE_DB_URL` | migrate, rls-audit | **Yes** (reset the database password) |
| `SUPABASE_DB_URL_DEV` | migrate, once dev exists | Yes |
| `CRON_SECRET` | migrate, post-deploy-watch | **Yes** |
| `SLACK_WEBHOOK_URL` | migrate, rls-audit, post-deploy-watch, slack-announce | **Yes** |
| `SLACK_BOT_TOKEN` | slack-autopilot, slack-lifecycle | **Yes** |
| `ANTHROPIC_API_KEY` | slack-autopilot | **Yes** |
| `VERCEL_TOKEN` | vercel-diagnose, vercel-protect | **Always**: it is tied to a person's Vercel account |
| `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_TOKEN` | jira-autopilot, parked | Delete them; Jira is off |

**GitHub, Actions repository variables**

| Name | What |
|---|---|
| `PRODUCTION_URL` | The address the watchdog checks. Set it to `https://app.robinsonsgeneralstore.ca` |
| `DEV_URL` | The dev site, once it exists |
| `SLACK_REQUEST_CHANNEL` | The Slack channel ID the autopilot reads (accepted as a secret too) |
| `SLACK_REQUIRE_MENTION` | Optional. `false` only for a requests-only channel |

## Proof the move worked

Run these after Step 5. Each is a check, not a reading of the settings page.

- [ ] `https://app.robinsonsgeneralstore.ca/api/health` answers `ok: true`.
- [ ] `curl -sD- -o /dev/null https://app.robinsonsgeneralstore.ca/api/health | grep -i x-vercel-id`
      starts with `yul1` (Montreal).
- [ ] A merge to main produces a production deploy on the **store's** Vercel team.
- [ ] Actions, Apply database scripts, run it by hand: the gate step prints a non-zero length
      for the connection secret.
- [ ] Actions, "Say something in Slack", posts in the channel.
- [ ] Post-deploy watch runs green against the custom domain.
- [ ] The owner signs in; a staff account signs in and sees no dollar figures.
- [ ] Supabase, Database, Backups lists a backup from the day after the Pro upgrade.
- [ ] One invoice photo goes through Capture on the new Anthropic key.

## Close-out

When every box above is ticked:

1. Remove the developer from what they no longer need: the Vercel team, the Supabase
   organization (or keep them as Developer), the Slack app's collaborators, and any Drive
   shares. Keep GitHub Write only while work continues.
2. If the developer is leaving entirely, rotate everything marked **Yes** above.
3. Delete the Lawson "PO Details.docx" from Drive. It still holds a full card number.
4. Record the date of the handover in docs/STATUS.md, and update the "Who holds it" column
   here to read "The store" all the way down.
