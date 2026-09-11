-- VIN complet des vehicules, prive : cette table ne doit jamais etre exposee
-- publiquement. stock.json (servi au site, commite dans le repo public) ne
-- contient que les 6 premiers caracteres du VIN, jamais l'integralite.
--
-- Facultatif : si cette table n'existe pas, l'admin fonctionne quand meme
-- (le VIN complet n'est simplement pas persiste entre deux sessions).

CREATE TABLE IF NOT EXISTS vehicle_vins (
  car_id     TEXT PRIMARY KEY,
  vin_full   TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
