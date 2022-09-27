Create the test table: `npx wrangler@d1 d1 execute test-d1 --command='CREATE TABLE Test (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name TEXT NOT NULL);'`

List tables: `npx wrangler@d1 d1 execute test-d1 --command='SELECT * FROM sqlite_master;'`
