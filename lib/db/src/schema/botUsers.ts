import {
  bigint,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const botUsersTable = pgTable(
  "bot_users",
  {
    telegramId: bigint("telegram_id", { mode: "number" }).primaryKey(),
    username: text("username"),
    firstName: text("first_name"),
    referralCode: text("referral_code").notNull(),
    referredBy: bigint("referred_by", { mode: "number" }),
    referralCount: integer("referral_count").notNull().default(0),
    premiumUntil: timestamp("premium_until", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    referralCodeIdx: uniqueIndex("bot_users_referral_code_idx").on(
      t.referralCode,
    ),
  }),
);

export const botReferralsTable = pgTable(
  "bot_referrals",
  {
    referrerId: bigint("referrer_id", { mode: "number" }).notNull(),
    referredId: bigint("referred_id", { mode: "number" }).notNull().primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type BotUser = typeof botUsersTable.$inferSelect;
export type InsertBotUser = typeof botUsersTable.$inferInsert;
