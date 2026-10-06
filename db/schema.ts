import { pgTable, text, timestamp, integer, index, uuid } from 'drizzle-orm/pg-core';

export const profiles = pgTable('profiles', {
  userId: text('user_id').primaryKey(),
  name: text('name').notNull(),
  gameId: text('game_id'),
  bio: text('bio').notNull().default(''),
  region: text('region').notNull().default('EU'),
  instagram: text('instagram').notNull().default(''),
  tiktok: text('tiktok').notNull().default(''),
  photo: text('photo').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('profiles_region_idx').on(table.region)]);

export const scores = pgTable('scores', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').notNull().references(() => profiles.userId, { onDelete: 'cascade' }),
  rankPoints: integer('rank_points').notNull().default(0),
  kills: integer('kills').notNull().default(0),
  wins: integer('wins').notNull().default(0),
  matches: integer('matches').notNull().default(0),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('scores_user_date_idx').on(table.userId, table.recordedAt)]);

export const guilds = pgTable('guilds', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: text('owner_id').notNull().unique().references(() => profiles.userId, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  gameId: text('game_id').notNull(),
  region: text('region').notNull(),
  description: text('description').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('guilds_region_idx').on(table.region)]);

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').notNull().references(() => profiles.userId, { onDelete: 'cascade' }),
  room: text('room').notNull(),
  body: text('body').notNull(),
  mode: text('mode').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('messages_room_date_idx').on(table.room, table.createdAt)]);
