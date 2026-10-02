// One job with longer log tails, for the detail view.
import { jobDetail, loadConfig } from 'launchboard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request) {
  const label = new URL(request.url).searchParams.get('label') || '';
  const detail = label ? jobDetail(loadConfig(), label) : null;
  if (!detail) return Response.json({ error: `no job on this board is labelled ${label}` }, { status: 404 });
  return Response.json(detail, { headers: { 'cache-control': 'no-store' } });
}
