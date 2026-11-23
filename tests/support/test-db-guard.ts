/**
 * Safety guard: integration tests may only ever touch a database whose name ends in "_test".
 * This prevents a mis-set env var from truncating the production database.
 */
export function assertTestDatabaseUrl(url: string | undefined): string {
  if (!url) throw new Error("DATABASE_URL_TEST is not set; refusing to run integration tests.");
  let dbName: string;
  try {
    dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("DATABASE_URL_TEST is not a valid URL; refusing to run integration tests.");
  }
  if (!dbName.endsWith("_test")) {
    throw new Error(`Database name "${dbName}" must end in "_test"; refusing to run integration tests.`);
  }
  return url;
}
