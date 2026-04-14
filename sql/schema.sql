-- Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client',   -- client | staff | admin
  account_type TEXT NOT NULL DEFAULT 'Particulier',  -- Entreprise | Particulier
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Email verification tokens
CREATE TABLE IF NOT EXISTS email_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,  -- deposit | allocation | release
  amount_cents INTEGER NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Messages (one thread per client, thread_id = client user_id)
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Staff invite tokens (for initial password setup)
CREATE TABLE IF NOT EXISTS staff_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  token TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  used BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Vehicle reservations
CREATE TABLE IF NOT EXISTS vehicle_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_slug TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deposit_cents INTEGER NOT NULL,
  remaining_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  cancellation_requested BOOLEAN DEFAULT FALSE,
  cancellation_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservations_user ON vehicle_reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_vehicle ON vehicle_reservations(vehicle_slug);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON vehicle_reservations(status);
