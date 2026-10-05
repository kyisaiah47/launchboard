# LaunchBoard

LaunchBoard shows every scheduled job on your Mac, including what is running, what failed, and what ran today.

LaunchBoard is a local web page and a small job wrapper for launchd, the scheduler built into macOS. It reads jobs in `~/Library/LaunchAgents`, keeps jobs whose labels start with your prefix, and shows them on one page that updates every two seconds.

## What it shows

For each job, LaunchBoard shows:

- **Its schedule.** LaunchBoard reads the plist's `StartInterval`, `StartCalendarInterval`, `KeepAlive`, `WatchPaths` and `RunAtLoad` keys and displays values such as "every 5 minutes" or "daily at 09:00". Interval and calendar jobs also show their next due time.
- **Whether it is loaded and running.** LaunchBoard reads `launchctl list` to show which jobs launchd has loaded and which process ID each running job holds.
- **Its last exit code.** LaunchBoard takes the code from the wrapper's ledger when the job uses the wrapper, and from launchd otherwise. A job killed by a signal shows the signal's name.
- **The last lines of its logs.** LaunchBoard reads the files named in the plist's `StandardOutPath` and `StandardErrorPath`. It also reads the log written by the wrapper.
- **What it did today.** For jobs that use the wrapper, LaunchBoard lists every run since midnight with its time, duration, exit code and last line of output.

The page shows a sentence summary at the top. It filters jobs that need attention, are running, ran today or are not loaded. It also has a search box and a detail panel for the selected job.

## The wrapper

launchd remembers only a job's last exit code. `launchboard run` records every run and stops a job that keeps failing with the same exit code.

```xml
<key>ProgramArguments</key>
<array>
  <string>/usr/bin/env</string>
  <string>launchboard</string>
  <string>run</string>
  <string>com.example.backup</string>
  <string>--log</string>
  <string>--</string>
  <string>/usr/local/bin/backup.sh</string>
</array>
```

- **One ledger row per run.** Each run appends a JSON line to `<log-dir>/ledger/<date>.jsonl`. The line contains the run's start, end, duration, exit code and last line of output.
- **Backoff.** After a failure, the next attempt waits at least 15 minutes. The wait doubles after each consecutive failure, up to 6 hours. A tick inside the wait is skipped and recorded as held. A successful run clears the wait.
- **Breaker.** After 3 consecutive failures with the same exit code, the wrapper trips the job. The wrapper skips every later tick until you run `launchboard reset <label>`. A job with changing exit codes receives only the backoff.
- **Deferral.** Exit code 75 (`EX_TEMPFAIL`) means "try again later". The wrapper records the run as held, and the run does not count as a failure.
- **Runtime ceiling.** The wrapper stops a run that lasts longer than 12 hours and records exit 124. Change the limit with `--max-runtime`.
- **Transparent.** The job receives the same arguments, working directory and environment. Its output passes through unchanged. The wrapper exits with the job's own exit code, so `launchctl list` shows that exit code.

Run options include `--log`, which appends the job's output to `<log-dir>/<label>.log`. `--max-fails <n>` changes the trip threshold. `--no-trip` keeps the backoff and never trips. `--no-backoff` runs every tick and still trips.

launchd starts jobs with a short `PATH` that does not include Homebrew. Set `PATH` in the plist's `EnvironmentVariables` so `/usr/bin/env` can find `launchboard`, as the examples do.

## Install

LaunchBoard needs Node.js 20 or later and has no dependencies.

```sh
npm install -g launchboard
```

## Start the board

```sh
launchboard --prefix com.example.
```

Open http://127.0.0.1:3990. Stop LaunchBoard with Ctrl-C.

Run `launchboard status` to print the board once in the terminal. Add `--json` to get the same JSON that the page reads.

## Configuration

| Setting | Flag | Environment variable | Default |
|---|---|---|---|
| Label prefix | `--prefix` | `LAUNCHBOARD_PREFIX` | every job |
| Labels to hide | `--exclude` | `LAUNCHBOARD_EXCLUDE` | none |
| Log directory | `--log-dir` | `LAUNCHBOARD_LOG_DIR` | `~/Library/Logs/launchboard` |
| Port | `--port` | `LAUNCHBOARD_PORT` | `3990` |
| Address | `--host` | `LAUNCHBOARD_HOST` | `127.0.0.1` |
| Plist directories | `--agents-dir` | `LAUNCHBOARD_AGENTS_DIRS` | `~/Library/LaunchAgents` |

You can repeat prefixes, exclusions and plist directories, or separate them with commas. You can also put the same settings in `~/.config/launchboard/config.json`:

```json
{
  "prefix": ["com.example."],
  "logDir": "~/Library/Logs/launchboard",
  "port": 3990
}
```

Flags override environment variables, and environment variables override the config file.

## Build your own app

```sh
launchboard --app console --out my-board
launchboard --app simple --out my-board
launchboard --app both --out my-board
```

Each command writes a Next.js app whose API routes call LaunchBoard.

- **Console** shows every job in a table and places the open job's details beside it.
- **Simple** shows jobs that need attention first. You can open logs, runs and programs on request.
- **Both** installs the two views. Each view's header shows a switch beside the name.

Run `cd my-board && npm install && npm run dev`, then open http://127.0.0.1:3991.

## Examples

The `examples` folder contains two plists that run `/bin/echo` through the wrapper. One runs every 5 minutes, and the other runs daily at 09:00. To try them:

```sh
cp examples/*.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.launchboard.hello.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.launchboard.morning.plist
launchboard --prefix com.example.launchboard.
```

Run `launchctl bootout gui/$(id -u)/<label>` for each label, then delete the files.

## What it never does

- LaunchBoard never loads, unloads, starts or stops a job. It runs only `launchctl list` and `plutil` to read a plist saved in binary form.
- The board answers GET requests only. It binds to 127.0.0.1 unless you choose another address.
- The board refuses requests whose Host header is not its own address. This prevents a web page from reading it through DNS rebinding.
- LaunchBoard makes no network requests and sends nothing anywhere.

## HTTP API

| Path | What it returns |
|---|---|
| `/api/state` | The snapshot: every job, the counts and today's runs. |
| `/api/job?label=<label>` | One job with the last 60 lines of each log. |
| `/events` | The snapshot as server-sent events, every two seconds. |
| `/health` | `ok` and the number of jobs on the board. |

## Library

```js
import { collect, loadConfig } from 'launchboard';

const snapshot = collect(loadConfig({ flags: { prefix: ['com.example.'] } }));
console.log(snapshot.counts);
```

## Development

```sh
npm test
npm run scrub
```

The tests parse the example plists and a fixture ledger. They never call `launchctl`. The scrub gate in `scripts/scrub-gate.mjs` fails when any file contains a personal email address, a home directory path, a key-shaped string or another private identifier. CI runs both checks on every push.

## License

MIT. Copyright 2026 Compound Labs.
