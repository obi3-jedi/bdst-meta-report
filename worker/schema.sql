-- BDST stream platform (Cloudflare D1). Apply with:
--   npx wrangler@3.114.0 d1 execute <database> --remote --file schema.sql --env <env>
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,            -- Discord user id
  username TEXT NOT NULL,
  name TEXT,
  avatar TEXT,
  created INTEGER NOT NULL,
  seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,    -- SHA-256 of the token; the token itself is only in the user's browser
  user_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS pending (  -- short-lived sign-in state and one-time login codes
  key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  melee_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  date TEXT,
  venue TEXT,
  best_of INTEGER NOT NULL DEFAULT 3,
  top_cut INTEGER NOT NULL DEFAULT 8,
  settings TEXT NOT NULL DEFAULT '{}', -- stream settings: take30, take30Swap, take30Colors, mat, pos
  overlay_key TEXT NOT NULL UNIQUE,    -- secret in the OBS overlay link
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tournaments_melee ON tournaments (melee_id);
CREATE TABLE IF NOT EXISTS members (
  tournament_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,             -- owner | stream
  added INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, user_id)
);
CREATE INDEX IF NOT EXISTS members_user ON members (user_id);
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER NOT NULL DEFAULT 25,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS invites_t ON invites (tournament_id);
