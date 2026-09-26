import { AuthenticatedShell } from '@/components/authenticated-shell';

export default function DistributorLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  return (
    <AuthenticatedShell params={params} surface="distributor">
      {children}
    </AuthenticatedShell>
  );
}
