import { pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

/** The person who owns this install. Amuse is single-owner, so there is one row ("owner"). */
export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey(),
  name: varchar("name", { length: 80 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
