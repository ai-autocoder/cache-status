# cache-status

A Claude Code mod that shows, in the prompt footer, whether the conversation is still in the
prompt cache and how long until the cache expires.

```
🟢 Cache 59m      warm, 59 minutes left
🟡 Cache 6m       warm, expires soon (last 10 minutes; last minute on the 5m lifetime)
🔴 Cache expired  the next prompt rewrites the whole conversation to the cache
⚪ Cache off      the last request was not cached
```

The indicator appears after the first model request of a session and updates every 15 seconds.

## Why it matters

Every prompt re-sends the whole conversation. While the cache is warm those tokens are read from
the cache at a fraction of the normal input rate; once it expires they are written to the cache
again at a higher rate. On a long conversation that is the difference between a cheap prompt and
an expensive one, so it is worth knowing before you come back to an old session.

## Where it works

- **Terminal (Claude Code CLI)**: the indicator is one of the dim mode labels at the right of the
  footer under the prompt. In the classic layout, or in a narrow terminal, it takes a row of its
  own just below.
- **Desktop app**: the same footer indicator, drawn beside the mode labels.
- **VS Code extension, mobile app, `claude -p` and SDK hosts**: no footer indicator, because those
  surfaces do not draw this part of the footer. The `/cache-status` command is still registered.

Mods are an early-access part of Claude Code and the API can change between releases. Tested on
Claude Code 2.1.322.

## Install

At the prompt of a terminal session:

```
/plugin install cache-status --marketplace ai-autocoder/cache-status
```

Answer `y` to add the marketplace, then pick a scope. The mod is active in that session straight
away and in every session started after.

From a shell:

```bash
claude plugin install cache-status --marketplace ai-autocoder/cache-status
```

Sessions that were already open pick it up after `/reload-plugins`. The one-line form needs Claude
Code 2.1.275 or later; on an older build, or if you prefer two steps:

```bash
claude plugin marketplace add ai-autocoder/cache-status
claude plugin install cache-status@ai-autocoder
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then
**Plugins**, **Add marketplace** with `ai-autocoder/cache-status`, then **Add plugin**.

To update or remove it:

```bash
claude plugin update cache-status@ai-autocoder
claude plugin uninstall cache-status@ai-autocoder
claude plugin marketplace remove ai-autocoder
```

## Use

- **Footer indicator**: shown in the terminal and the desktop app after the first model request;
  nothing to click.
- **`/cache-status`**: prints a summary: whether the cache is warm and when it expires, how many
  tokens the next prompt re-sends and at which rate, and what share of the conversation's input
  was read from the cache.

## Setting

| Setting | Values | Default | Meaning |
|---|---|---|---|
| Prompt cache lifetime (`cacheTtl`) | `1h`, `5m` | `1h` | How long the API keeps the session's cache entry after the last request. |

Set it when installing (`--config cacheTtl=5m`), or later with
`/plugin configure cache-status@ai-autocoder`; restart Claude Code to apply a change.

The usage figures a mod receives do not say which lifetime a request used, so the countdown is
only right if this setting matches your session.

## How it works

- A `turn.step` hook reads each main-conversation request's usage (`cache_read_input_tokens`,
  `cache_creation_input_tokens`, `input_tokens`, `output_tokens`) and stores the last request and
  the session totals in `$.state`.
- The cache counts as warm while `now < last request + lifetime` and the last request used the
  cache.
- A `ui.render` hook on the `SessionMode` site shows the indicator: in the terminal it adds it to
  the footer's mode labels, elsewhere it draws its own text beside them.
- A `$.clock.every` timer ticks every 15 seconds so the countdown redraws.
- A `session.end` hook forgets the stored request and totals on `/clear`.

## Limits

- The countdown is an estimate, counted from the last main-conversation response the mod saw.
- Main conversation only. Subagents keep caches of their own and are not counted.
- Switching model discards the cache; the indicator only notices after the next request.
- After `/compact` the figures still describe the conversation before the compaction, until the
  next request.
- Token counts are measured. The cache rates quoted by `/cache-status` (0.1x for a read, 2x or
  1.25x for a write) are the API's published ratios, not measurements.
- The desktop app draws the footer as plain text, so the dot is an emoji rather than coloured text.

## Develop

Run the mod from a working copy, without installing it:

```bash
claude --plugin-dir /path/to/cache-status
```

An interactive session started this way reloads the mod when a file is saved. Copying the folder
to `~/.claude/skills/cache-status/` does the same for every session (`claude plugin list` shows it
as `cache-status@skills-dir`). Use a working copy or the installed mod, not both at once.

```bash
claude plugin validate .
npx -p typescript tsc -p .
```

`tsc` needs the type files the engine writes to `.claude-plugin/types/` the first time an
interactive session loads the mod from its folder; that folder is not committed.
