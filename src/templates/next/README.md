# __APP_NAME__

This Next.js version of LaunchBoard has one page for every scheduled job on your Mac. It shows what is running, what failed and what ran today.

This app was scaffolded with `launchboard --app __MODE__`.

## Run it

```sh
npm install
npm run dev
```

You can open http://127.0.0.1:3991. The scripts bind to 127.0.0.1, so the board is not reachable from other machines.

## Choose the jobs

The API routes read the same configuration as the `launchboard` command. You can set it in the environment or in `~/.config/launchboard/config.json`.

```sh
LAUNCHBOARD_PREFIX=com.example. npm run dev
```

| Variable | What it sets | Default |
|---|---|---|
| `LAUNCHBOARD_PREFIX` | Show jobs whose label starts with this. Comma-separate several. | every job |
| `LAUNCHBOARD_EXCLUDE` | Hide jobs whose label starts with this. | none |
| `LAUNCHBOARD_LOG_DIR` | Where the wrapper writes its ledger and logs. | `~/Library/Logs/launchboard` |
| `LAUNCHBOARD_AGENTS_DIRS` | Where plists are read from. | `~/Library/LaunchAgents` |

## What is in it

- `app/api/state/route.js` returns the snapshot from `collect()` in the `launchboard` package.
- `app/api/job/route.js` returns one job with longer log tails.
- `components/ConsoleBoard.jsx` is the Console view. It shows a dense table with the open job beside it.
- `components/SimpleBoard.jsx` is the Simple view. It shows the jobs that need attention first and puts details in disclosures.
- With `--app both`, `components/site-view/` holds the view switch. Each view's header shows it beside the name. The app saves the view choice in `localStorage` under `launchboard:view`.

The app only reads. No route loads, unloads or starts a job.
