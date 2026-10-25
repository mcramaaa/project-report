/** Guard so test helpers can never wipe a non-test database. Kept free of Prisma imports for globalSetup. */
export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_test')) throw new Error(`Refusing to run tests against non-test database "${name}".`);
}
