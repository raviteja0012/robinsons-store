# Handover call: agenda and run sheet

Status: DRAFT, 2026-10-24. Owner: the developer. For: Ravi Kiran (store owner), the developer,
and the new team member if they have joined.

**The call has one outcome: the store's database, hosting and code end up owned by the store
through admin@robinsonsgeneralstore.ca, and six questions get answered.** About 60 minutes.
Every step and exact name is in docs/HANDOVER.md; this page is the order to run them in on the
call.

## Bring to the call

- [ ] The admin@robinsonsgeneralstore.ca password, and the Vianet login (https://myaccount.vianet.ca/)
- [ ] The store's card (two upgrades: Supabase Pro $25 a month, Vercel Pro $20 a month)
- [ ] The phone that will hold the two-factor codes for the store's accounts
- [ ] The developer signed in to their own Supabase, Vercel and GitHub accounts, in a
      different browser from the one admin@ uses
- [ ] docs/HANDOVER.md open on screen, for the exact names to type

Never read a password, card number or code aloud on a recorded call, and never paste one into
chat.

## Agenda

| Time | Item | Who | Done when |
|---|---|---|---|
| 0 to 5 | Why: the two plan risks and what ADR-001 decides | The developer | Ravi Kiran approves ADR-001, or says what to change |
| 5 to 15 | Decisions, table below | Ravi Kiran | Each has an answer or an owner and a date |
| 15 to 20 | Vianet: read the domain expiry; store vault created; admin@ saved in it | Ravi Kiran | HO-01 and HO-02 closed |
| 20 to 30 | Supabase: admin@ signs up, is invited as Owner, upgrades to Pro | Both | Organization plan reads `pro` |
| 30 to 42 | Vercel: store team on Pro, project transferred and accepted, four checks | Both | Project shows under the store's team; checks pass |
| 42 to 55 | GitHub: admin@ user, store organization, repository transferred, secrets compared | Both | Repository URL is under the store's organization |
| 55 to 60 | What is left (keys, dev environment), who does each, by when | All | Written into the HANDOVER progress table |

## Decisions needed from Ravi Kiran

| ID | Question | Recommendation |
|---|---|---|
| ADR-001 | Approve: every account is opened with admin@ and owned by the store | Approve |
| HO-02 | Which password vault: Bitwarden or 1Password | Either; pick the one he will actually open |
| HO-03 | Monthly spend limit on the Anthropic key | Set one; the app has run at about $5 to $40 a month [R `docs/PLATFORM.md`] |
| HO-06 | Who is the second store-controlled owner on each service | A second store person, not the developer |
| Vendor (b) | Is the minimum order still asked on every vendor edit, or only where the ordering questions are on screen | Only where shown; that is what is built today [R `docs/REQUIREMENTS.md`, OPEN] |
| Vendor view | Show a "not answered yet" list so the roughly 130 vendors can be filled in a few at a time | Yes |

## If the new team member is on the call

Walk ONBOARDING.md: they fill in the intake form, and nothing is granted until the store
owns the account it is granted on. Their access is added after the GitHub step, as the last
item, from the store's accounts.

## After the call

Update the progress table and "Name actually used" column in docs/HANDOVER.md, close the
answered open items, and record the date in docs/STATUS.md.

**Basis: 2 claims checked this session (2026-10-24), 2 confirmed, 0 killed, 1 source.** The
Anthropic cost range and the vendor decision's current build were read from
`docs/PLATFORM.md` and `docs/REQUIREMENTS.md`. Source: this repository.
