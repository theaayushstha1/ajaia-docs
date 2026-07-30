import { notFound } from 'next/navigation';

import { HttpError, getDocumentForUser, isValidUuid, listCollaborators } from '@/db/dal';
import DocumentWorkspace from '@/components/DocumentWorkspace';
import { requireUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: PageProps<'/docs/[id]'>) {
  const { id } = await props.params;
  if (!isValidUuid(id)) return { title: 'Not found · Ajaia Docs' };

  const user = await requireUser();
  const found = await getDocumentForUser(id, user.id);
  return { title: found ? `${found.doc.title} · Ajaia Docs` : 'Not found · Ajaia Docs' };
}

export default async function DocumentPage(props: PageProps<'/docs/[id]'>) {
  const { id } = await props.params;

  // A malformed id never reaches Postgres — an invalid uuid cast throws, and
  // that would surface as a 500 on a URL that should simply not exist.
  if (!isValidUuid(id)) notFound();

  const user = await requireUser();

  // Deliberately 404, not 403, when the caller has no access. A 403 confirms
  // the document exists, which turns this route into an existence oracle.
  const found = await getDocumentForUser(id, user.id);
  if (!found) notFound();

  const { doc, role, ownerName } = found;
  if (role === 'stranger') notFound();

  let collaborators: { userId: string; name: string; email: string }[] = [];
  if (role === 'owner') {
    try {
      collaborators = await listCollaborators(doc.id, user.id);
    } catch (error) {
      // A failure to list collaborators should not take down the editor.
      if (!(error instanceof HttpError)) throw error;
    }
  }

  return (
    <DocumentWorkspace
      docId={doc.id}
      initialTitle={doc.title}
      initialContent={doc.content}
      initialUpdatedAt={doc.updatedAt.toISOString()}
      role={role}
      ownerName={ownerName}
      currentUserName={user.name}
      initialCollaborators={collaborators}
    />
  );
}
