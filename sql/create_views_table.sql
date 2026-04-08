-- Run once in your Neon Postgres database.
-- The Netlify functions also run this automatically (CREATE TABLE IF NOT EXISTS)
-- so the table is created on first request even if you skip this step.

CREATE TABLE IF NOT EXISTS car_views (
  car_id      TEXT        PRIMARY KEY,
  views_total INTEGER     NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
