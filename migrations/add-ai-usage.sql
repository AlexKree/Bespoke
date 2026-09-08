-- Limitation de débit des fonctions IA (concierge, calculateur d'import, pré-rapport photo).
-- Partagée entre toutes les instances de fonctions, contrairement au compteur en mémoire.
--
-- Cette table est facultative : si elle n'existe pas, les fonctions retombent
-- sur le limiteur en mémoire et continuent de répondre.

CREATE TABLE IF NOT EXISTS ai_usage (
  id         BIGSERIAL PRIMARY KEY,
  ip         TEXT NOT NULL,
  action     TEXT NOT NULL,        -- 'concierge' | 'import-cost' | 'inspection'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index servant la requête de comptage (ip + action sur une fenêtre glissante).
CREATE INDEX IF NOT EXISTS idx_ai_usage_lookup
  ON ai_usage (ip, action, created_at DESC);

-- Purge : à exécuter périodiquement, ou via pg_cron si disponible.
-- DELETE FROM ai_usage WHERE created_at < now() - interval '7 days';
