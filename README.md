# repro-mastra-writeapikey-windows

Repro for a Windows-only bug in `create-mastra`. The API key passed to `--llm-api-key` is written
to `.env` through a shell `echo`, and `cmd.exe` mangles it. The project is scaffolded with a broken
credential, exit code 0, no warning.

## Status

Fixed upstream in `create-mastra@1.20.0`. https://github.com/mastra-ai/mastra/issues/19736 was
closed by https://github.com/mastra-ai/mastra/pull/19825, a larger CLI refactor that took over the
change from https://github.com/mastra-ai/mastra/pull/19738, which was closed. From 1.20.0 the key is
written with `fs.appendFile`, without a shell. Checked on Windows on 2026-11-12:
`create-mastra@1.38.0` writes all three keys below intact.

The repro is pinned to `create-mastra@1.19.0`, the last version with the bug. The command below no
longer runs from 1.20.0 on, since `-c`, `--no-example` and `--dir` are gone from the CLI.

Same root cause as
[repro-mastra-clone-template-windows](https://github.com/tehfreak/repro-mastra-clone-template-windows)
(POSIX shell quoting handed to `cmd.exe`), but a different function in a different file, so it's
tracked on its own.

## What happens

```
npx create-mastra@1.19.0 myapp --llm openai --llm-api-key "AIzaSyBx9K2mQ==" -c agents,tools --no-example --dir src/
```

```
key passed in      bytes written to .env
sk-proj-abc123     OPENAI_API_KEY=sk-proj-abc123 \r\n
sk-proj-a+b/c=d    OPENAI_API_KEY=sk-proj-a+b/c\=d \r\n
AIzaSyBx9K2mQ==    OPENAI_API_KEY=AIzaSyBx9K2mQ\=\= \r\n
```

No key survives intact. The trailing space is latent, since `dotenv` trims trailing whitespace on
unquoted values, so a purely alphanumeric key still works in practice. The escaping is what breaks
things: any key containing `=` arrives corrupted, which covers base64-padded keys, the usual shape
for Google and Azure credentials. It surfaces later as an auth error at runtime, with nothing
pointing back at the scaffolder.

Read the raw bytes rather than `type` or `cat`, which hide the trailing space:

```powershell
[System.IO.File]::ReadAllText("myapp\.env") | ConvertTo-Json
```

Don't add `--default` when reproducing. That flag drops `--llm-api-key` entirely and writes
`.env.example` instead, which hides this bug. That is a separate defect.

Checked with `create-mastra@1.19.0`.

## Run it

Needs Node >= 22.18, which runs TypeScript without a build step.

```
npm install
npm run repro
```

`repro.ts` drives the published `create-mastra@1.19.0`, one scaffold per key shape, then reads each
generated `.env` back as raw bytes. It prints `VERDICT: CORRUPTED` or `VERDICT: CLEAN`. Three
scaffolds take a couple of minutes, since each one installs its own dependencies.

Types aren't checked at runtime because Node strips them, so `npm run typecheck` does that
separately. `tsconfig.json` sets `erasableSyntaxOnly` so `tsc` rejects anything Node's stripper
can't handle.

## Why it's a bug

`packages/cli/src/commands/init/utils.ts:671-681`:

```ts
const escapedKey = shellQuote.quote([key]);
const escapedApiKey = shellQuote.quote([apiKey ? apiKey : 'your-api-key']);
await exec(`echo ${escapedKey}=${escapedApiKey} >> ${envFileName}`);
```

Two separate defects, both from routing this through a shell:

1. `shell-quote` escapes `=` as `\=`. Correct POSIX, meaningless to `cmd.exe`, so the backslashes
   land in the file literally.
2. `cmd.exe` `echo` keeps the separating space. `echo VALUE >> file` appends everything between
   `echo ` and `>>`, including the space before the redirect. This hits every key.

Neither happens on Linux or macOS, where `exec` uses `/bin/sh` and the quoting is correct. Mastra's
CI runs on ubuntu only, so it can't catch this.

Worth noting separately: the key is interpolated into a shell command string, so shell
metacharacters in it are not escaped for the shell that ends up running. On a developer machine
that crosses no trust boundary, since the value is the user's own and they already have a shell.
It's listed here because the suggested fix removes it along with everything else.

## Suggested fix

Skip the shell.

```diff
- const escapedKey = shellQuote.quote([key]);
- const escapedApiKey = shellQuote.quote([apiKey ? apiKey : 'your-api-key']);
- await exec(`echo ${escapedKey}=${escapedApiKey} >> ${envFileName}`);
+ await fs.appendFile(envFileName, `${key}=${apiKey ?? 'your-api-key'}\n`, 'utf8');
```

That covers the escaping, the trailing space and the shell interpolation at once. All three keys
above then round-trip byte for byte.

## CI

`.github/workflows/reproduce.yml` runs the script on `windows-latest` and `ubuntu-latest` and
expects a different verdict on each:

```
windows-latest   VERDICT: CORRUPTED
ubuntu-latest    VERDICT: CLEAN
```

The job is green while both hold, so it goes red if the bug is fixed or if the platform split stops
being a platform split.
