/*
  File d'attente du pre-rapport photo.

  L'analyse vision (Claude + schema structure + plusieurs photos) prend 9-15 s :
  impossible dans les 10 s d'une fonction Netlify synchrone. Le traitement passe
  par une fonction "background" (plafond 15 min) et cette table sert de boite
  aux lettres entre les trois fonctions :
    ai-inspection                -> INSERT (status 'pending')
    ai-inspection-run-background -> UPDATE 'running' puis 'done' / 'error'
    ai-inspection-result         -> SELECT (interroge par le navigateur)

  Contrairement a ai_usage, cette table est REQUISE : sans elle, le pre-rapport
  photo ne fonctionne pas (la fonction renvoie une erreur explicite).

  Colonnes :
    request      { images:[{media_type,data}], context, listing_url } ; les
                 images sont retirees des la fin de l'analyse.
    result       rapport structure en cas de succes.
    error_code   code court en cas d'echec (timeout, upstream_error...).
    error_detail detail lisible pour le journal.

  Purge conseillee, a rejouer periodiquement :
    DELETE FROM ai_inspection_jobs WHERE created_at < now() - interval '2 days';
*/

CREATE TABLE IF NOT EXISTS ai_inspection_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  lang TEXT NOT NULL DEFAULT 'fr',
  request JSONB,
  result JSONB,
  error_code TEXT,
  error_detail TEXT,
  image_count INT NOT NULL DEFAULT 0,
  listing_url TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_inspection_jobs_created ON ai_inspection_jobs (created_at);

CREATE INDEX IF NOT EXISTS idx_ai_inspection_jobs_status ON ai_inspection_jobs (status, created_at);
