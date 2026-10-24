# Handover checklist: every task, step by step

Status: DRAFT, 2026-10-24. Owner: the developer. Approver: Ravi Kiran.

**Tick through this top to bottom; each step says which account does it.** The exact names to
type (team, organization, usernames) are in the "The target" table in docs/HANDOVER.md; the
reasons are in docs/adr/ADR-001-the-store-owns-every-account.md.

Who is who in this checklist:

| Label | Means |
|---|---|
| **YOU** | The developer's personal accounts: Supabase, Vercel, and GitHub `raviteja0012`. These own everything today and do the giving |
| **ADMIN** | `admin@robinsonsgeneralstore.ca`, the store's identity. Does the receiving and paying |
| **RAVI** | Ravi Kiran, the store owner: decisions and the store card |
| **CLAUDE** | Checks from a Claude session that each step landed |

Never used here: any work account. Never typed into chat, email or a document: a password,
two-factor code, card number or API key.

Menu names are as of October 2026 and were not clicked through from here [J-open: if a screen
does not match, stop and describe what you see rather than guessing].

---

## Task 0. Get ready (10 minutes)

- [ ] 0.1 **YOU**: open two browser windows. Normal window for YOU, private (incognito) window
      for ADMIN. Never sign in to both in the same window.
- [ ] 0.2 **ADMIN**: open the admin@ inbox: https://myaccount.vianet.ca/, then Webmail beside
      the mailbox. Keep this tab open; every invite and code arrives here.
- [ ] 0.3 **RAVI**: have the store card ready (Supabase Pro $25 a month, Vercel Pro $20 a month).
- [ ] 0.4 **RAVI**: have the phone that will hold the store's two-factor codes, with an
      authenticator app installed.

## Task 1. The store vault (15 minutes)

- [ ] 1.1 **RAVI** decides Bitwarden or 1Password (HO-02).
- [ ] 1.2 **ADMIN**: sign up for it with `admin@robinsonsgeneralstore.ca`, as an organization
      named "Robinson's General Store".
- [ ] 1.3 **ADMIN**: save the admin@ mailbox password in it as the first item.
- [ ] 1.4 **RAVI**: write the vault's master password on paper. One copy stays at the store,
      one with Ravi Kiran.
- [ ] 1.5 From here on, every new password and recovery code goes straight into the vault.

## Task 2. Push the waiting work to GitHub (5 minutes)

Six commits with all of this paperwork are waiting, not yet on GitHub.

- [ ] 2.1 **YOU**, on your laptop, in your clone of `robinsons-store`, check git uses
      raviteja0012: `gh auth status` if you have the GitHub CLI.
- [ ] 2.2 **YOU**: save the patch file Claude sent (`handover-commits.patch`), then run:

      git fetch origin
      git checkout -b claude/review-pending-requests-43g9hk origin/main
      git am path/to/handover-commits.patch
      git push -u origin claude/review-pending-requests-43g9hk

- [ ] 2.3 **YOU**: open the pull request on GitHub as a draft. Merge it after the call, so
      HANDOVER.md on main is the version you work from.

## Task 3. The domain (5 minutes)

- [ ] 3.1 **RAVI** (Vianet): https://myaccount.vianet.ca/, then Domains, then
      `robinsonsgeneralstore.ca`. Read the **expiry date** and whether **auto-renew** is on.
- [ ] 3.2 If it shows expired or pending: stop and call Vianet, 1-800-788-0363 ext 5214. If
      it shows a new expiry date: write that date in docs/DOMAIN_EMAIL.md (closes HO-01).
- [ ] 3.3 **RAVI** (Vianet): set the account's contact email to admin@.
- [ ] 3.4 **YOU** (GitHub, raviteja0012): repository, Settings, Secrets and variables,
      Actions, **Variables** tab, New repository variable: name `PRODUCTION_URL`, value
      `https://app.robinsonsgeneralstore.ca`.

## Task 4. Supabase: the database (15 minutes)

Do not move the project. Change who owns the organization it already sits in.

- [ ] 4.1 **YOU** (normal window): sign in to Supabase with your personal account. Open
      https://supabase.com/dashboard/org/idijiwqgwlsebgpkfzry/team
- [ ] 4.2 **YOU**: click **Invite**, enter `admin@robinsonsgeneralstore.ca`, role **Owner**
      (not Administrator: only an Owner can add owners), send.
- [ ] 4.3 **ADMIN** (private window): in the admin@ inbox, open the Supabase invite and click
      its link.
- [ ] 4.4 **ADMIN**: create the Supabase account there with admin@. New password into the
      vault. Turn on two-factor (Account, Security).
- [ ] 4.5 **ADMIN**: accept the invite. You should now see organization `robinsons-store`.
- [ ] 4.6 **ADMIN**: open https://supabase.com/dashboard/org/idijiwqgwlsebgpkfzry/billing.
      Add the store card, choose **Pro**, set the billing email to admin@.
- [ ] 4.7 **YOU**: stay Owner for now. You step down to Developer at close-out (Task 12).
- [ ] 4.8 **CLAUDE**: confirm the organization plan now reads `pro`. Next day: Database,
      Backups lists a backup.

## Task 5. GitHub: the code (25 minutes)

Do this before Vercel, so Vercel is reconnected once, to the repository's final home.

- [ ] 5.1 **ADMIN** (private window): https://github.com/signup with admin@. Username
      `robinsons-store-admin`. Verify the email from the inbox. Password into the vault.
- [ ] 5.2 **ADMIN**: Settings, Password and authentication, turn on **two-factor**. Recovery
      codes into the vault.
- [ ] 5.3 **ADMIN**: https://github.com/account/organizations/new?plan=free. Organization
      name `robinsons-general-store` (if taken: `robinsonsgeneralstore`). Contact email
      admin@. "Belongs to": **a business**, name 1000476363 ONTARIO INC.
- [ ] 5.4 **ADMIN**: the new organization, People, Invite member, `raviteja0012`, role
      **Owner**. You need this to move the repository in.
- [ ] 5.5 **YOU** (normal window, raviteja0012): accept the invitation from the GitHub
      notification or email.
- [ ] 5.6 **YOU**: open https://github.com/raviteja0012/robinsons-store/settings, scroll to
      Danger Zone, **Transfer**. New owner: the store's organization. Type the repository
      name to confirm.
- [ ] 5.7 **YOU**: on your laptop, point your clone at the new address:
      `git remote set-url origin https://github.com/<store org>/robinsons-store.git`
- [ ] 5.8 **YOU**: in the moved repository, Settings, Secrets and variables, Actions. Compare
      the names against the register in docs/HANDOVER.md. Re-add anything missing, including
      the `PRODUCTION_URL` variable from 3.4.
- [ ] 5.9 **YOU**: Settings, Actions, General, Workflow permissions: tick **Allow GitHub
      Actions to create and approve pull requests**. Save.
- [ ] 5.10 **ADMIN**: install the Claude GitHub app on the organization (GitHub, Settings,
      Applications, or from claude.ai/connect-github) and give it the `robinsons-store`
      repository, so the Slack autopilot and future Claude sessions can reach it.
- [ ] 5.11 Write the organization name actually used in docs/HANDOVER.md.

## Task 6. Vercel: the hosting (25 minutes)

- [ ] 6.1 **ADMIN** (private window): https://vercel.com/signup, continue with email, admin@,
      code from the inbox. Turn on two-factor.
- [ ] 6.2 **ADMIN**: https://vercel.com/teams/create. Name "Robinson's General Store", slug
      `robinsons-general-store`. Plan **Pro**, store card.
- [ ] 6.3 **ADMIN**: the new team, Settings, Members, invite your personal Vercel account as
      **Member**, so the project can be moved into a team you belong to.
- [ ] 6.4 **YOU** (normal window): accept the team invite.
- [ ] 6.5 **YOU**: open the project `robinsons-store`, Settings, General, scroll to **Transfer
      Project**, choose the store's team. If it offers a transfer link or code instead, open
      it in the private window as ADMIN and accept.
- [ ] 6.6 **ADMIN**: in the store team's copy of the project, check each one and note it here:
  - [ ] Domains lists `app.robinsonsgeneralstore.ca`
  - [ ] Environment Variables lists every name in the HANDOVER register
  - [ ] Functions, Function Region is **Montreal (yul1)**
  - [ ] Cron Jobs lists `/api/alerts`
- [ ] 6.7 **ADMIN**: Settings, Git: connect the repository at its **new** GitHub address,
      production branch `main`. Install the Vercel GitHub app on the store's organization
      when asked.
- [ ] 6.8 **YOU**: merge any small change to main. **CLAUDE**: confirm a production deploy is
      Ready on the store's team.
- [ ] 6.9 If a deploy shows as blocked because its author is not a team member: add whoever
      merges as a Member.
- [ ] 6.10 **ADMIN**: Account settings, Tokens, create a token scoped to the store team. Put
      it straight into GitHub as the `VERCEL_TOKEN` secret (replace the old one).

## Task 7. New keys under the store (30 minutes)

Each key goes straight from the service into Vercel or GitHub. Nobody copies it anywhere else.

**Anthropic (the AI)**
- [ ] 7.1 **ADMIN**: https://console.anthropic.com/, sign up with admin@, organization name
      "Robinson's General Store". Billing: store card. Set the monthly limit RAVI chose (HO-03).
- [ ] 7.2 **ADMIN**: API Keys, Create key, name `robinsons-store-production`.
- [ ] 7.3 **ADMIN**: paste it into Vercel, project, Settings, Environment Variables,
      `ANTHROPIC_API_KEY`, Production and Preview, Save. Then into GitHub, repository secret
      `ANTHROPIC_API_KEY`.
- [ ] 7.4 **ADMIN**: Vercel, Deployments, Redeploy the latest production deploy.
- [ ] 7.5 **RAVI**: capture one real invoice photo in the app. It reads correctly.
- [ ] 7.6 **YOU**: in your personal Anthropic console, revoke the old key.

**Slack**
- [ ] 7.7 **ADMIN**: make sure admin@ is the **Primary Owner** of robinsonsgeneralstore.slack.com
      (workspace settings; YOU transfer primary ownership if it is you today) (HO-04).
- [ ] 7.8 **ADMIN**: https://api.slack.com/apps, open the existing app and add admin@ as a
      collaborator, or Create New App, From a manifest, paste `docs/slack-app-manifest.yml`.
- [ ] 7.9 **ADMIN**: OAuth and Permissions, Install to workspace, copy the **Bot User OAuth
      Token** (starts `xoxb-`) into GitHub secret `SLACK_BOT_TOKEN`.
- [ ] 7.10 **ADMIN**: Incoming Webhooks, add one for the requests channel, copy the URL into
      GitHub secret `SLACK_WEBHOOK_URL`.
- [ ] 7.11 **ADMIN**: in Slack, `/invite @<the app's name>` in the requests channel.
- [ ] 7.12 **YOU**: GitHub, Actions, "Say something in Slack", Run workflow. The message
      appears in the channel.

**The daily due-date email (Resend), optional**
- [ ] 7.13 **ADMIN**: https://resend.com/signup with admin@. Domains, add `robinsonsgeneralstore.ca`.
- [ ] 7.14 **RAVI**: call Vianet hosting (1-800-788-0363 ext 5214) and read them the DNS
      records Resend shows. Vianet has no self-serve DNS editor.
- [ ] 7.15 **ADMIN**: once Resend shows Verified, API Keys, Create. Into Vercel: `RESEND_API_KEY`,
      `ALERT_EMAIL_FROM` (an address at the domain), `ALERT_EMAIL_TO` (who receives it).

**Shared secret and database keys**
- [ ] 7.16 **YOU**: on your laptop run `openssl rand -hex 32`. Put the result in Vercel
      `CRON_SECRET` and GitHub secret `CRON_SECRET`, the same value in both.
- [ ] 7.17 **ADMIN** (Supabase): Project settings, Database, Reset database password. Build
      `SUPABASE_DB_URL` from the session pooler URI on port 5432 (docs/SUPABASE_SETUP.md), put
      it in the GitHub secret.
- [ ] 7.18 **ADMIN** (Supabase): Project settings, API, copy the service role key into Vercel
      `SUPABASE_SERVICE_ROLE_KEY`, Production only. This turns on the Team page.
- [ ] 7.19 **ADMIN**: Vercel, Redeploy once more so every new value is live.

## Task 8. Prove it worked (10 minutes)

- [ ] 8.1 https://app.robinsonsgeneralstore.ca/api/health answers `ok: true`.
- [ ] 8.2 `curl -sD- -o /dev/null https://app.robinsonsgeneralstore.ca/api/health | grep -i x-vercel-id`
      shows `yul1` as the **second** field. The header reads `<edge>::<function region>::<id>`;
      the first field is the Vercel edge nearest whoever runs the curl and can be anything.
      Before the move, on 2026-10-24, it read `cle1::yul1::...`: a pass.
- [ ] 8.3 GitHub, Actions, Apply database scripts, Run workflow: the gate prints a non-zero length.
- [ ] 8.4 GitHub, Actions, Post-deploy watch, Run workflow: green.
- [ ] 8.5 RAVI signs in to the app as owner and sees everything.
- [ ] 8.6 Supabase, Database, Backups lists a backup (the day after Task 4).

## Task 9. Before any staff login is made

- [ ] 9.1 **YOU, with Claude**: fix ARCH-03, so dollar amounts are hidden from staff by the
      database itself, not only by the screens. It is queued as its own task, "Enforce money
      visibility in the database".
- [ ] 9.2 Only then: RAVI or a manager adds staff from the app's Admin, Team page.

## Task 10. The new team member

- [ ] 10.1 **YOU**: send them ONBOARDING.md and ask for the intake form back.
- [ ] 10.2 **ADMIN**: invite them on each service with the role in ONBOARDING.md section 2:
      GitHub org member with Write, Vercel Member, Supabase Developer, Slack member.
- [ ] 10.3 They complete the "Day 1 proof" list in ONBOARDING.md.

## Task 11. Dev environment, on the store's accounts (30 minutes, YOU with Claude)

- [ ] 11.1 **ADMIN** (Supabase): create a second organization, **Free**, and in it a project
      `robinsons-store-dev`, Canada Central.
- [ ] 11.2 **YOU**: in its SQL editor run `supabase/schema.sql`, then `seed.sql`, then `seed_dev.sql`.
- [ ] 11.3 **YOU**: GitHub secret `SUPABASE_DB_URL_DEV` (session pooler, 5432) for the dev project.
- [ ] 11.4 **ADMIN** (Vercel, store team): new project from the same repository, production
      branch `develop`, environment variables pointing at the **dev** Supabase. Check twice.
- [ ] 11.5 **YOU**: GitHub variable `DEV_URL` = the dev site's address.
- [ ] 11.6 **YOU**: create the `develop` branch from `main` and push it.
- [ ] 11.7 **CLAUDE**: confirm the dev migration ran and the guard reports two different projects.

## Task 12. Close-out

- [ ] 12.1 **RAVI** names a second store-controlled owner for Supabase, Vercel and GitHub, and
      ADMIN adds them (HO-06).
- [ ] 12.2 **ADMIN**: drop YOU to Developer (Supabase), remove or keep as Member (Vercel),
      outside collaborator with Write (GitHub).
- [ ] 12.3 **YOU**: delete the Jira secrets from GitHub (`JIRA_BASE_URL`, `JIRA_USER_EMAIL`,
      `JIRA_API_TOKEN`); Jira is off.
- [ ] 12.4 **RAVI**: delete the Lawson "PO Details.docx" from Drive. It holds a full card number.
- [ ] 12.5 **YOU**: fill in every "Name actually used" in docs/HANDOVER.md and record the
      handover date in docs/STATUS.md.

## Still open, not part of the move

- [ ] Create `invoices@` on Vianet, which unblocks email invoice intake.
- [ ] Repoint or delete the `stories@` alias; it forwards store mail to the previous owners.
- [ ] RAVI: re-record the 12:18 voice note ("deposit on the device") in the app's Suggestions.
- [ ] RAVI: answer vendor decision (b), whether the minimum order is asked on every edit, and
      whether to add a "not answered yet" vendor list.
- [ ] Upload Departments&WorkFlow.xlsx so the payment-record fields can be checked.

**Basis: 4 claims checked this session (2026-10-24), 4 confirmed, 0 killed, 2 sources.** The
Supabase organization id and Owner-only rights (Supabase API and docs), the Vianet support
number (`docs/DOMAIN_EMAIL.md:21`) and the GitHub variable fallback
(`.github/workflows/post-deploy-watch.yml:54`). Menu paths are `[J-open]` as stated at the top.
