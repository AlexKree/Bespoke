/*
  NB : inutile de jouer ce fichier a la main — netlify/lib/market-price.js
  cree la table au premier usage (ensureTable). Garde comme reference.

  Prix marche proposes par l'IA pour les vehicules du stock — PRIVE.

  Circuit :
    admin (bouton « Proposer un prix marché »)  -> INSERT/UPDATE status 'pending'
    market-price-run-background (worker, 15 min) -> 'running' puis 'proposed' / 'error'
    admin                                        -> lit la proposition, l'admin valide

  Rien de cette table n'est publie : seul le prix VALIDE par l'admin est ecrit
  dans stock.json (market_price_eur / market_price_date), donc sur la fiche.

  Colonnes :
    request      fiche vehicule envoyee au modele (sans notre prix de vente).
    proposal     { market_price_eur, low_eur, high_eur, confidence,
                   comparables:[...], rationale } en cas de succes.
    error_code   code court en cas d'echec.
*/

CREATE TABLE IF NOT EXISTS vehicle_market_prices (
  car_id       TEXT PRIMARY KEY,
  status       TEXT NOT NULL DEFAULT 'pending',
  request      JSONB,
  proposal     JSONB,
  error_code   TEXT,
  error_detail TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_market_prices_status ON vehicle_market_prices (status, requested_at);
