import { AuthenticatedShell } from '@/components/authenticated-shell';

// The guard lives here, in the layout, so it runs once for the whole /admin
// subtree. A page that forgets to call it is still protected.
export default function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  return (
    <AuthenticatedShell params={params} surface="admin">
      {children}
    </AuthenticatedShell>
  );
}
