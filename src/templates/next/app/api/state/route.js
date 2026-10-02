// The board's snapshot. The same read `launchboard status --json` prints: plists, launchctl list,
// the wrapper's ledger and the last lines of each job's logs. Read-only.
import { collect, loadConfig, VERSION } from 'launchboard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  try {
    return Response.json({ version: VERSION, ...collect(loadConfig()) }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
