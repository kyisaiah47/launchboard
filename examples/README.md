# Examples

These two plists run harmless `/bin/echo` commands through `launchboard run`.

| File | Label | Schedule | Command |
|---|---|---|---|
| `com.example.launchboard.hello.plist` | `com.example.launchboard.hello` | every 5 minutes, and once when it loads | `/bin/echo hello from launchd, every five minutes` |
| `com.example.launchboard.morning.plist` | `com.example.launchboard.morning` | daily at 09:00 | `/bin/echo good morning, the 09:00 job ran` |

Both pass `--log`, so each run's output is appended to `~/Library/Logs/launchboard/<label>.log`. Both set `PATH` in `EnvironmentVariables`, because launchd's default `PATH` does not include the Homebrew or `/usr/local` folders where npm installs `launchboard`.

## Try them

```sh
cp examples/*.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.launchboard.hello.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.launchboard.morning.plist
launchboard --prefix com.example.launchboard.
```

The hello job runs as soon as it loads, so the board shows one run within a few seconds.

## Remove them

```sh
launchctl bootout gui/$(id -u)/com.example.launchboard.hello
launchctl bootout gui/$(id -u)/com.example.launchboard.morning
rm ~/Library/LaunchAgents/com.example.launchboard.*.plist
```

The test suite parses these files. It never loads them.
