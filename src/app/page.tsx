import Dashboard from '@/components/Dashboard';
import { listDashboardDocuments } from '@/db/dal';
import { requireUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await requireUser();
  const rows = await listDashboardDocuments(user.id);

  return <Dashboard rows={rows} currentUserName={user.name} />;
}
