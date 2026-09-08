-- File d'attente du pre-rapport photo.
--
-- L'analyse vision (Claude + schema structure + plusieurs photos) prend 9-15 s :
-- impossible dans les 10 s d'une fonction Netlify synchrone. Le traitement passe
-- donc par une fonction "background" (plafond 15 min) et cette table sert de
-- boite aux lettres entre les trois fonctions :
--   ai-inspection            -> INSERT (status 'pending')
--   ai-inspection-run-background -> UPDATE 'running' puis 'done' / 'error'
--   ai-inspection-result     -> SELECT (interroge par le navigateur)
--
-- Contrairement a ai_usage, cette table est REQUISE : sans elle, le pre-rapport
-- photo ne fonctionne pas (la fonction renvoie une erreur explicite).

CREATE TABLE IF NOT EXISTS ai_inspection_jobs (
  id           TEXT PRIMARY KEY,                       -- identifiant opaque genere cote fonction
  status       TEXT NOT NULL DEFAULT 'pending',        -- pending | running | done | error
  lang         TEXT NOT NULL DEFAULT 'fr',
  request      JSONB,                                  -- { images:[{media_type,data}], context, listing_url } ; images purgees une fois l'analyse finie
  result       JSONB,                                  -- rapport structure en cas de succes
  error_code   TEXT,                                   -- code court en cas d'echec (timeout, upstream_error...)
  error_detail TEXT,                                   -- detail lisible pour le journal / le debug
  image_count  INT  NOT NULL DEFAULT 0,
  listing_url  TEXT,
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sert la purge et la detection des jobs bloques en 'pending'.
CREATE INDEX IF NOT EXISTS idx_ai_inspection_jobs_created ON ai_inspection_jobs (created_at);
CREATE INDEX IF NOT EXISTS idx_ai_inspection_jobs_status  ON ai_inspection_jobs (status, created_at);

-- Purge : a executer periodiquement (ou via pg_cron). Les images sont deja
-- retirees de `request` des la fin de l'analyse ; ceci nettoie les lignes.
-- DELETE FROM ai_inspection_jobs WHERE created_at < now() - interval '2 days';
