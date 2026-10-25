import { createInterface } from 'node:readline/promises';
import { loadRootEnv, requireEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/** Drops every table (incl. _prisma_migrations) in the DATABASE_URL database. Never in production. */
async function main() {
  loadRootEnv();
  if (process.env.NODE_ENV === 'production') throw new Error('schema:drop tidak boleh dijalankan di production.');
  const prisma = new PrismaService(requireEnv('DATABASE_URL'));
  try {
    const db = (await prisma.$queryRaw<{ db: string }[]>`SELECT DATABASE() AS db`)[0]?.db;
    if (!db) throw new Error('DATABASE_URL tidak menunjuk ke database.');
    const tables = (await prisma.$queryRaw<{ name: string }[]>`
      SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`).map((t) => t.name);
    if (tables.length === 0) return console.log(`Database ${db} sudah kosong.`);

    // Data loss guard: type the database name, or pass --yes for scripted use.
    if (!process.argv.includes('--yes')) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(`Hapus ${tables.length} tabel beserta seluruh datanya di database "${db}"? Ketik nama database untuk melanjutkan: `);
      rl.close();
      if (answer.trim() !== db) return console.log('Dibatalkan.');
    }

    // One transaction = one connection, so FOREIGN_KEY_CHECKS applies to every DROP.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
      for (const table of tables) await tx.$executeRawUnsafe(`DROP TABLE \`${table.replaceAll('`', '``')}\``);
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    });
    console.log(`${tables.length} tabel di database ${db} dihapus. Jalankan "npm run db:migrate" lalu "npm run db:seed" untuk membuat ulang.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
