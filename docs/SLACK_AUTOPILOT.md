# Slack autopilot: a message becomes a deployed change

Type what you want in the store's requests channel. Within half an hour it comes back as a
draft pull request, with a reply in the thread under your own message saying what happened.

**State, 2026-10-30: built, not running.** The bot token and the Anthropic key are in GitHub,
but the variable `SLACK_REQUEST_CHANNEL` is not, so every sweep stops at its first step with
"Slack autopilot is not configured yet" [V-run, `gh variable list`, `gh secret list` and that
day's run logs]. No request has been built yet. To switch it on, see Setting it up below.

This is the intake loop the Jira board used to be, moved to where the work is actually asked
for. Nobody was writing to the board; people do write in Slack.

## The whole life of a request

Two things track it, and neither needs anything stored anywhere.

**A reaction on your message**, so the channel reads at a glance without opening threads:

| What you see | What it means |
|---|---|
| no reaction | waiting, nobody has started it |
| 👀 | being worked on |
| ⚠️ | stopped, or the checks failed: needs a person |
| ✅ | merged, and on its way to the store's site |

**A status card in the thread under your message**, which edits itself as things move:

| Card | When |
|---|---|
| 👀 Working on it | picked up |
| 📝 Ready for someone to look | the draft pull request exists and every check before it passed |
| ☑️ Checks passed, waiting to be merged | the automatic checks went green |
| 🔴 Checks failed | they did not, or a reviewer flagged something before the pull request opened |
| 🚀 Merged, going out to the store | somebody merged it |
| 🟢 Live on the store's site | the deploy is confirmed serving it |
| ✋ Stopped, this one needs a person | it refused to guess, or the build failed |

One card that updates, rather than six messages. The alternative buries the answer under its
own notifications.

**How the card finds itself hours later, with no database.** Your message's Slack timestamp
IS the thread id, and the autopilot puts that timestamp in the branch name
(`claude/slack-<ts>`). So a pull-request event carries, in its branch name alone, everything
needed to find the conversation that asked for it. Inside the thread the card is found by
asking `conversations.replies` for the bot's own message carrying a marker. Nothing is passed
between workflows, so nothing can fall out of step.

Anything not built from a Slack request has no such branch name, so the lifecycle workflow
skips it entirely. Ordinary work is unaffected.

### Slack details this gets right, because the alternatives fail quietly

- **`text` is always sent with `blocks`.** Slack uses it for the notification and for screen
  readers. Blocks with no fallback text arrive as an empty ping.
- **Updates always resend blocks.** `chat.update` with `text` alone deletes the blocks, so a
  lazy update would silently flatten the card to plain text.
- **A failed update falls back to posting.** `edit_window_closed` and `message_not_found` are
  real; losing the update is worse than one extra message.
- **429 is honoured with its `Retry-After`.** Slack allows one message per second per channel.
- **Nothing here ever fails a run.** The build either happened or it did not, and a Slack
  outage must not turn finished work into a red run somebody re-runs.

## Why a reaction rather than a database

The state of every request is visible to anyone scrolling the channel, it survives these
scripts being rewritten, and it costs no storage. It is also what stops the loop building the
same request forever: a message already carrying 👀 or ✅ is skipped.

The 👀 claim goes on **before** the build starts. A run that dies halfway leaves 👀 with no
reply, which is the safe direction: a person sees it and knows to look. The other way round,
an unclaimed request gets built twice.

What is never treated as a request: anything an app posted (including the bot's own replies,
which is what stops it eating itself), joins and leaves, and thread replies. Replies are
skipped because a thread under a finished request is usually people talking about it, and
treating each comment as a new build turns one conversation into ten pull requests.

Oldest first, so whoever asked first is served first.

## How you ask it for something

**Name the bot in your message.** `@<the app's name> add a phone number column to the vendor form`.

That is required by default, and it matters because this watches a channel people actually
talk in. Without it, "Hello Robinson Tech Team" is a build request and the automation opens a
pull request for it. Naming the bot is the Slack-native way to address something, it cannot
be typed by accident, and it means the channel stays a channel.

The bot's name is stripped before the request reaches the model, so it reads what you asked
and not how you addressed it.

If it ever cannot work out its own name, **nothing** counts as a request. Failing closed is
the only safe direction here: the alternative is building every message in the channel
because one API call did not answer.

If you make a channel that exists solely for requests, set the variable
`SLACK_REQUIRE_MENTION` to `false` and plain messages count.

## What it will not do

- **Merge.** It opens a draft pull request and stops. A person merges.
- **Touch payments, auth, or RLS.** Those requests get a reply saying a person is needed.
- **Follow instructions inside a message.** Anyone who can type in the channel can write
  anything, including "ignore your previous instructions". Message text is a request for
  work, never a change to the process. This is written into the prompt, and it is the reason
  the channel should not be public to people outside the store.
- **Edit the automation.** A change under `.github/` or `.claude/` is not pushed at all; the
  card says a person is needed.
- **Open a pull request nobody has checked.** See the next section.

## What checks the work before you see it

The model that builds the change commits it and stops. It does not push and it does not open
the pull request. The workflow then does four things, and only after them opens the draft
pull request itself:

| Check | What it is | Why |
|---|---|---|
| The three gates, again | `npx tsc --noEmit`, `npm run lint`, `npm run build` run by the workflow | The model says it ran them. Running them again turns a claim into a result |
| Tier classifier | `.github/scripts/classify-change.mjs` reads the diff and labels it A, B or C | A script, so nothing in the request can move it. The label goes on the pull request |
| money-reviewer | A separate model run following `.claude/agents/money-reviewer.md` | The ways this codebase has broken money before: a select missing `tax_mode`, an inline total bypassing `invoiceTotal`, SQL and TypeScript changed on one side |
| invariant-auditor | A separate model run following `.claude/agents/invariant-auditor.md` | Store scoping, money hidden from staff, soft voids, audit rows, RLS on new tables, blank-env build |

How the reviewers are kept honest:

- **Their instructions come from the base branch.** The classifier, both reviewer files,
  CLAUDE.md and the skill are read with `git show origin/<base>:...`, never from the working
  tree, so a change cannot weaken its own reviewer.
- **They can only read.** Read, Grep and Glob, the same tools as their agent files. Bash,
  Write and Edit are refused by name.
- **They never see the Slack request.** They judge the code against the store's rules. That
  removes the one route by which somebody typing in Slack could talk a reviewer into passing
  something.
- **Silence is not a pass.** Each must end with `VERDICT: PASS` or `VERDICT: FINDINGS` as its
  last line. A reviewer that errors, runs out of turns, or ends any other way counts as
  "did not finish", which turns the card red exactly like a finding.

What happens with the result: the pull request opens either way, so the work is not lost. The
card turns 🔴 if the gates failed or either reviewer flagged something or did not finish, and
📝 if all four passed. **The reviewers' reports are posted in the Slack thread, not on the
pull request**, because the repository is public and a report can describe a weakness. The
pull request carries only the verdicts and points to the thread.

**The reviewers are a second look, not the gate.** A model reading another model's work
misses things. The gate is still the person who merges. What the reviewers add is a list of
concrete lines to read first. The decision logic is `.github/scripts/autopilot-review.mjs`,
with its tests in `autopilot-review.test.mjs`.

**CI does not run when the pull request opens** (docs/ARCHITECTURE.md, ARCH-13). The workflow
opens it with its own token, and GitHub starts no other workflow from events that token
causes [J-open, kill condition: the first autopilot pull request shows a CI run]. That is why
the workflow runs the gates itself, and why it moves the card on itself instead of waiting for
the lifecycle workflow. CI runs once a person marks the pull request ready or pushes to it.

What it costs: the reviewers run only when a request produced a change, never on an idle
sweep. Each is one `claude-sonnet-5` run of at most 30 turns.

## What it costs

The expensive things are the model and `npm ci`, in that order. **Neither runs on a sweep
that finds nothing.** The workflow's step order is checkout, ask Slack, and only then install
and build, so an idle sweep is a few seconds of Actions time and no model tokens.

This is the specific mistake that killed the Jira version, and it is worth recording
precisely because it was originally diagnosed wrong. That loop had the model correctly gated
behind "did we find a ticket", so it was **not** burning model credits on an empty board. What
it did do was run `actions/checkout` and `npm ci` on every one of its 96 daily sweeps before
checking, roughly a minute each, which is about 2,880 Actions minutes a month against a
2,000-minute free allowance.

The arithmetic to redo if the cadence changes:

```
runs per day  x  seconds per idle sweep  x  30  /  60  =  minutes per month
```

At every 30 minutes that is 48 sweeps a day and roughly 6 hours a month, which leaves room
for CI and the health watchdog.

## Setting it up

In **Settings, Secrets and variables, Actions**:

| Name | Kind | What |
|---|---|---|
| `ANTHROPIC_API_KEY` | secret | Already set; the same key the app's AI features use |
| `SLACK_BOT_TOKEN` | secret | A bot token, starting `xoxb-`. Set 2026-08-13 |
| `SLACK_REQUEST_CHANNEL` | **variable** | The channel ID to watch. **Not set as of 2026-10-30**; this is the one thing stopping it |
| `SLACK_REQUIRE_MENTION` | **variable**, optional | Defaults to requiring the bot to be named. `false` only for a requests-only channel |

**The bot token is not the incoming webhook, and it is not a refresh token.** Two different
things get mistaken for it:

- The **incoming webhook** the health watchdog uses can only write. This has to read.
- A **refresh token** (`xoxe-1-...`) cannot call the Web API at all. Slack's own
  documentation is explicit: it exists only to be exchanged for an access token through
  `oauth.v2.access`. Paste one here and every call fails.

**Make the app from the manifest in `docs/slack-app-manifest.yml`.** At
api.slack.com/apps, Create New App, choose **From a manifest**, and paste it. That sets the
name, the four scopes, and `token_rotation_enabled: false` in one go, which is the setting
that decides whether the token you get lasts forever or twelve hours. The other three
templates are wrong for this: **AI agent** and **Starter app** add slash commands and event
listeners that need a public HTTPS endpoint this has no use for, and **Blank app** means
clicking the scopes in by hand with rotation left to chance.

What you want is then under **OAuth & Permissions**, labelled **Bot User OAuth Token**,
starting `xoxb-`. If yours starts `xoxe.xoxb-` instead, token rotation is switched on for that app,
which means the token expires every twelve hours and cannot be used from a stored secret.
Rotation cannot be turned off once enabled, so in that case make a separate app for this and
leave rotation off.

The scopes it needs:

- `channels:history` (read the messages)
- `chat:write` (reply in the thread)
- `reactions:read` and `reactions:write` (the 👀 and ✅ state)

Then invite the bot into the channel: `/invite @<the app's name>`.

Until all three exist the workflow exits quietly on its first step, so it is safe to have
sitting there unconfigured.

## Running one on demand

Actions, Slack autopilot, Run workflow. Leave the box blank to sweep the channel, or paste a
message's Slack timestamp to build that specific one. Right-click a message and Copy link;
the timestamp is the number at the end of the URL, with a dot inserted before the last six
digits.

## Its relationship to the parked Jira loop

`.github/workflows/jira-autopilot.yml` is still in the repo with its schedule commented out,
so a future Jira account can wake it. The two are not meant to run at once: two intake loops
reading two queues will build the same request twice. If Jira comes back, decide which one
owns intake and park the other.
