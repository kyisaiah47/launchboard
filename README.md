# LaunchBoard

one page for every scheduled job on your Mac: what is running, what failed, what ran today

LaunchBoard is a local web page and a small job wrapper for launchd, the scheduler built into macOS. It reads the jobs in `~/Library/LaunchAgents`, keeps the ones whose label starts with your prefix, and shows each one on a single page that updates every two seconds.

## What it shows

For each job, LaunchBoard shows:

- **Its schedule.** The plist's `StartInterval`, `StartCalendarInterval`, `KeepAlive`, `WatchPaths` and `RunAtLoad` keys are turned into words, such as "every 5 minutes" or "daily at 09:00". Interval and calendar jobs also show when they are next due.
- **Whether it is loaded and running.** It reads `launchctl list`, so it knows which jobs launchd has loaded and which process ID each running job holds.
- **Its last exit code.** It takes the code from the wrapper's ledger when the job runs through the wrapper, and from launchd when it does not. A job killed by a signal shows the signal's name.
- **The last lines of its logs.** It reads the files named in the plist's `StandardOutPath` and `StandardErrorPath`, and the log the wrapper writes.
- **What it did today.** For jobs that run through the wrapper, it lists every run since midnight with its time, duration, exit code and the last line the job printed.

The page has a summary in sentences at the top, filters for jobs that need attention, are running, ran today or are not loaded, a search box, and a detail panel for the job you pick.

## The wrapper

launchd remembers only a job's last exit code. `launchboard run` adds a record of every run and stops a job that keeps failing the same way.

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

- **One ledger row per run.** Each run appends a JSON line to `<log-dir>/ledger/<date>.jsonl` with its start, end, duration, exit code and last line of output.
- **Backoff.** After a failure, the next attempt waits at least 15 minutes. The wait doubles with each failure in a row, up to 6 hours. A tick that lands inside the wait is skipped and recorded as held. Any successful run clears the wait.
- **Breaker.** After 3 failures in a row with the same exit code, the job is tripped. The wrapper skips every later tick until you run `launchboard reset <label>`. A job whose exit code keeps changing only gets the backoff.
- **Deferral.** Exit code 75 (`EX_TEMPFAIL`) means "try again later". It is recorded as held and does not count as a failure.
- **Runtime ceiling.** A run that lasts longer than 12 hours is stopped and recorded as exit 124. Change the limit with `--max-runtime`.
- **Transparent.** The job gets the same arguments, working directory and environment. Its output passes through unchanged. The wrapper exits with the job's own exit code, so `launchctl list` still shows the truth.

Run options: `--log` appends the job's output to `<log-dir>/<label>.log`. `--max-fails <n>` changes the trip threshold. `--no-trip` keeps the backoff and never trips. `--no-backoff` runs every tick and still trips.

launchd starts jobs with a short `PATH` that does not include Homebrew. Set `PATH` in the plist's `EnvironmentVariables` so `/usr/bin/env` can find `launchboard`, as the examples do.

## Install

LaunchBoard needs Node.js 20 or later. It has no dependencies.

```sh
npm install -g launchboard
```

## Start the board

```sh
launchboard --prefix com.example.
```

Open http://127.0.0.1:3990. Stop it with Ctrl-C.

To print the board once in the terminal, run `launchboard status`. Add `--json` to get the same JSON the page reads.

## Configuration

| Setting | Flag | Environment variable | Default |
|---|---|---|---|
| Label prefix | `--prefix` | `LAUNCHBOARD_PREFIX` | every job |
| Labels to hide | `--exclude` | `LAUNCHBOARD_EXCLUDE` | none |
| Log directory | `--log-dir` | `LAUNCHBOARD_LOG_DIR` | `~/Library/Logs/launchboard` |
| Port | `--port` | `LAUNCHBOARD_PORT` | `3990` |
| Address | `--host` | `LAUNCHBOARD_HOST` | `127.0.0.1` |
| Plist directories | `--agents-dir` | `LAUNCHBOARD_AGENTS_DIRS` | `~/Library/LaunchAgents` |

Prefixes, exclusions and plist directories can be repeated or separated by commas. The same settings can go in `~/.config/launchboard/config.json`:

```json
{
  "prefix": ["com.example."],
  "logDir": "~/Library/Logs/launchboard",
  "port": 3990
}
```

Flags win over environment variables, and environment variables win over the config file.

## Build your own app

```sh
launchboard --app console --out my-board
launchboard --app simple --out my-board
launchboard --app both --out my-board
```

Each command writes a Next.js app that calls LaunchBoard from its API routes.

- **Console** is the dense view: a table of every job with the open job's details beside it.
- **Simple** is the roomy view: the jobs that need attention come first, and logs, runs and programs open on request.
- **Both** installs the two views with a switch in the footer and a welcome dialog that explains the board and offers the choice.

Then run `cd my-board && npm install && npm run dev`, and open http://127.0.0.1:3991.

## Examples

The `examples` folder holds two plists that run `/bin/echo` through the wrapper. One runs every 5 minutes, and the other runs daily at 09:00. To try them:

```sh
cp examples/*.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.launchboard.hello.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.launchboard.morning.plist
launchboard --prefix com.example.launchboard.
```

To remove them, run `launchctl bootout gui/$(id -u)/<label>` for each label and delete the files.

## What it never does

- It never loads, unloads, starts or stops a job. The only programs it runs are `launchctl list`, and `plutil` to read a plist saved in binary form.
- The board answers GET requests only, and it binds to 127.0.0.1 unless you choose another address.
- It refuses requests whose Host header is not its own address, so a web page cannot read it through DNS rebinding.
- It makes no network requests and sends nothing anywhere.

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

The tests parse the example plists and a fixture ledger. They never call `launchctl`. The scrub gate in `scripts/scrub-gate.mjs` fails if any file holds a personal email address, a home directory path, a key-shaped string or another private identifier. CI runs both on every push.

## License

MIT. Copyright 2026 Compound Labs.
