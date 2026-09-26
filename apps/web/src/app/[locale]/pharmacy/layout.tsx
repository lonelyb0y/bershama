import { AuthenticatedShell } from '@/components/authenticated-shell';

export default function PharmacyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  return (
    <AuthenticatedShell params={params} surface="pharmacy">
      {children}
    </AuthenticatedShell>
  );
}
