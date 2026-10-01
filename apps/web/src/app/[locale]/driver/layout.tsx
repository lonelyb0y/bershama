import { AuthenticatedShell } from '@/components/authenticated-shell';

// The guard lives here, in the layout, so it runs once for the whole /driver
// subtree. A page that forgets to call it is still protected -- and that matters
// more on this surface than anywhere else, because /driver is where a signature is
// taken.
export default function DriverLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  return (
    <AuthenticatedShell params={params} surface="driver">
      {children}
    </AuthenticatedShell>
  );
}
