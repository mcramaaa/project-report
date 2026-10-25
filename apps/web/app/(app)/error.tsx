'use client';
import { Alert, Button } from '@/components/ui';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="panel form-panel space-y-4">
      <h1 className="text-xl font-semibold">Halaman belum dapat dimuat</h1>
      <Alert>Terjadi kendala saat memuat data. Coba lagi untuk melanjutkan.</Alert>
      <Button onClick={reset}>Coba lagi</Button>
    </section>
  );
}
