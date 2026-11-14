-- Mesur relational schema (SQLite dialect, used by the bundled server).
-- The PostgreSQL / Supabase equivalent with Row Level Security lives in
-- supabase/schema.sql. Table and column names are kept identical.
-- All ids are UUIDs, all timestamps ISO-8601 UTC, all lengths centimetres.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,              -- lives in auth.users on Supabase
  full_name       TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('customer','merchant','admin')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  preferred_unit  TEXT NOT NULL DEFAULT 'cm' CHECK (preferred_unit IN ('cm','in')),
  fit_preference  TEXT NOT NULL DEFAULT 'regular' CHECK (fit_preference IN ('slim','regular','relaxed','oversized')),
  is_sample       INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_measurements (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  height_cm    REAL NOT NULL CHECK (height_cm BETWEEN 120 AND 230),
  chest_cm     REAL NOT NULL CHECK (chest_cm BETWEEN 60 AND 170),
  waist_cm     REAL CHECK (waist_cm IS NULL OR waist_cm BETWEEN 45 AND 170),
  shoulder_cm  REAL CHECK (shoulder_cm IS NULL OR shoulder_cm BETWEEN 28 AND 65),
  hip_cm       REAL CHECK (hip_cm IS NULL OR hip_cm BETWEEN 55 AND 180),
  arm_cm       REAL CHECK (arm_cm IS NULL OR arm_cm BETWEEN 40 AND 95),
  inseam_cm    REAL CHECK (inseam_cm IS NULL OR inseam_cm BETWEEN 50 AND 110),
  thigh_cm     REAL CHECK (thigh_cm IS NULL OR thigh_cm BETWEEN 30 AND 100),
  neck_cm      REAL CHECK (neck_cm IS NULL OR neck_cm BETWEEN 25 AND 60),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchants (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  company_name   TEXT NOT NULL,
  contact_email  TEXT NOT NULL,
  website        TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','suspended')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_merchants_status ON merchants(status);

CREATE TABLE IF NOT EXISTS brands (
  id                  TEXT PRIMARY KEY,
  merchant_id         TEXT UNIQUE REFERENCES merchants(id) ON DELETE CASCADE,  -- NULL = platform-managed
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  logo_url            TEXT,
  description         TEXT,
  website             TEXT,
  country             TEXT,
  categories          TEXT NOT NULL DEFAULT '[]',   -- JSON array of category ids
  integration_status  TEXT NOT NULL DEFAULT 'not_integrated' CHECK (integration_status IN ('not_integrated','sandbox','live')),
  is_active           INTEGER NOT NULL DEFAULT 1,
  is_demo             INTEGER NOT NULL DEFAULT 0,   -- fictional demonstration data
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS size_charts (
  id          TEXT PRIMARY KEY,
  brand_id    TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  fit_type    TEXT NOT NULL DEFAULT 'regular' CHECK (fit_type IN ('slim','regular','relaxed','oversized')),
  unit        TEXT NOT NULL DEFAULT 'cm' CHECK (unit IN ('cm','in')),
  chart_type  TEXT NOT NULL DEFAULT 'body' CHECK (chart_type IN ('body','garment')),
  scope       TEXT NOT NULL DEFAULT 'brand' CHECK (scope IN ('brand','product')),
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (brand_id, name)
);
CREATE INDEX IF NOT EXISTS idx_size_charts_brand_category ON size_charts(brand_id, category);

CREATE TABLE IF NOT EXISTS size_chart_entries (
  id          TEXT PRIMARY KEY,
  chart_id    TEXT NOT NULL REFERENCES size_charts(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  ranges      TEXT NOT NULL,                  -- JSON: { "chest": {"min":93,"max":98}, ... } in the chart's unit
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (chart_id, label)
);
CREATE INDEX IF NOT EXISTS idx_entries_chart ON size_chart_entries(chart_id, sort_order);

CREATE TABLE IF NOT EXISTS products (
  id               TEXT PRIMARY KEY,
  brand_id         TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  external_id      TEXT NOT NULL,             -- public product identifier used by the widget
  name             TEXT NOT NULL,
  description      TEXT,
  category         TEXT NOT NULL,
  fit_type         TEXT NOT NULL DEFAULT 'regular' CHECK (fit_type IN ('slim','regular','relaxed','oversized')),
  size_chart_id    TEXT REFERENCES size_charts(id) ON DELETE SET NULL,
  available_sizes  TEXT NOT NULL DEFAULT '[]', -- JSON array; empty = every size in the chart
  ease             TEXT,                       -- JSON: designed ease in cm, e.g. {"chest":18}
  image_url        TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (brand_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id, is_active);

-- A customer's own recommendation history. Never exposed to merchants.
CREATE TABLE IF NOT EXISTS recommendations (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  brand_id        TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  product_id      TEXT REFERENCES products(id) ON DELETE SET NULL,
  product_name    TEXT,
  category        TEXT NOT NULL,
  status          TEXT NOT NULL,
  size_label      TEXT,
  match_score     INTEGER,
  confidence      TEXT,
  fit_preference  TEXT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('app','widget')),
  is_sample       INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recommendations_user ON recommendations(user_id, created_at);

CREATE TABLE IF NOT EXISTS widget_integrations (
  id               TEXT PRIMARY KEY,
  merchant_id      TEXT NOT NULL UNIQUE REFERENCES merchants(id) ON DELETE CASCADE,
  public_key       TEXT NOT NULL UNIQUE,       -- safe to ship in storefront HTML
  secret_key_hash  TEXT,                       -- SHA-256 of the secret API key; the key itself is shown once
  secret_last4     TEXT,
  allowed_origins  TEXT NOT NULL DEFAULT '[]', -- JSON array; empty = any origin
  config           TEXT NOT NULL DEFAULT '{}', -- JSON widget appearance
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- Anonymous analytics events. Contains no customer identifiers or measurements.
CREATE TABLE IF NOT EXISTS recommendation_events (
  id          TEXT PRIMARY KEY,
  brand_id    TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  product_id  TEXT REFERENCES products(id) ON DELETE SET NULL,
  type        TEXT NOT NULL CHECK (type IN ('impression','open','recommendation','size_selected')),
  status      TEXT,
  size_label  TEXT,
  source      TEXT NOT NULL CHECK (source IN ('app','widget','api')),
  is_sample   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_brand_time ON recommendation_events(brand_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_product ON recommendation_events(product_id);

CREATE TABLE IF NOT EXISTS platform_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
