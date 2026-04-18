-- Table pour les préférences d'alerte des clients
CREATE TABLE IF NOT EXISTS stock_alerts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT true,
  brands TEXT[], -- Array de marques (ex: {'Porsche','Ferrari'})
  max_price INTEGER, -- Prix maximum en euros
  min_year INTEGER, -- Année minimum
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_alerts_enabled ON stock_alerts(enabled);

-- Table pour logger les emails envoyés
CREATE TABLE IF NOT EXISTS email_notifications (
  id SERIAL PRIMARY KEY,
  email_to TEXT NOT NULL,
  subject TEXT NOT NULL,
  sent_at TIMESTAMP DEFAULT NOW(),
  status TEXT DEFAULT 'sent' -- 'sent', 'failed', 'bounced'
);

CREATE INDEX IF NOT EXISTS idx_email_notifications_sent_at ON email_notifications(sent_at DESC);
