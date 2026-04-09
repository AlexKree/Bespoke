-- =============================================================================
-- Fix: Add "The Bespoke Investment Car Company" to the Neon database
-- =============================================================================
-- Run this script in your Neon SQL console (https://console.neon.tech)
-- or via psql: psql "$NEON_DATABASE_URL" -f fix-bespoke-company.sql
-- =============================================================================

-- Step 1: Enable pgcrypto extension (required for password hashing in auth.ts)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Step 2: Check whether the company already exists
-- If a row is returned, the company exists in the DB.
-- In that case, the loop is caused by a bug in the application code (see notes below).
SELECT
  "Name",
  "Registration number",
  login,
  "Country"
FROM company
WHERE LOWER(login) = LOWER('Bespoke');

-- Step 3: Insert the company only if it does not already exist.
-- IMPORTANT: Replace the following placeholder values before running:
--   'BESPOKE-REG-001'   → your actual company registration number
--   'REPLACE_WITH_SECURE_PASSWORD' → the password you want to use for login "Bespoke"
--   'France'             → your actual country if different
--   'contact@...'        → your actual email address

INSERT INTO company (
  "Name",
  "Registration number",
  login,
  password_hash,
  "Country",
  "Email",
  "Phone"
)
SELECT
  'The Bespoke Investment Car Company',
  'BESPOKE-REG-001',
  'Bespoke',
  crypt('REPLACE_WITH_SECURE_PASSWORD', gen_salt('bf')),
  'France',
  '',          -- Replace with actual email address
  ''           -- Replace with actual phone number
WHERE NOT EXISTS (
  SELECT 1 FROM company WHERE LOWER(login) = LOWER('Bespoke')
);

-- Step 4: Verify the result
SELECT
  "Name",
  "Registration number",
  login,
  "Country"
FROM company
WHERE LOWER(login) = LOWER('Bespoke');

-- =============================================================================
-- Notes on the application-side loop bug (blockchain-bloom-works)
-- =============================================================================
-- Even after inserting the company, a redirect loop may still occur due to a bug
-- in src/hooks/client/useClientDetailsData.ts.
--
-- BUG 1 — Array index: The code checks only companyProfile[0] (first company
-- alphabetically). If other companies exist in the DB (e.g. "Demo Corp",
-- "Test Company Inc"), the Bespoke company will not be found because it is not
-- first in the list.
--
-- Fix in useClientDetailsData.ts (around line 53):
--   BEFORE:
--     let foundCompany = Array.isArray(companyProfile) ? companyProfile[0] : companyProfile;
--     if (foundCompany && foundCompany.Name === name && foundCompany["Registration number"] === regNumber) {
--
--   AFTER:
--     let foundCompany = Array.isArray(companyProfile)
--       ? companyProfile.find((c: any) => c.Name === name && c["Registration number"] === regNumber)
--       : companyProfile;
--     if (foundCompany) {
--
-- BUG 2 — Session not cleared: The catch block navigates to /client without
-- clearing sessionStorage, so ClientLogin.tsx immediately redirects back and
-- creates an infinite loop.
--
-- Fix in useClientDetailsData.ts (catch block, around line 83):
--   BEFORE:
--     } catch (error) {
--       console.error('Error loading company data:', error);
--       toast({ ... });
--       navigate('/client');
--     }
--
--   AFTER:
--     } catch (error) {
--       console.error('Error loading company data:', error);
--       toast({ ... });
--       sessionStorage.removeItem('clientName');
--       sessionStorage.removeItem('clientRegNumber');
--       sessionStorage.removeItem('clientLogin');
--       sessionStorage.removeItem('clientPassword');
--       navigate('/client');
--     }
--
-- BUG 3 — Server-side: GET /api/company returns all companies (ignores query
-- params name & registrationNumber). Add filtering in server/routes/company.ts:
--
--   router.get('/', async (req: Request, res: Response) => {
--     const { name, registrationNumber } = req.query;
--     let query = 'SELECT "Name","Country","Registration number","Address","Email","Phone","web site" FROM company';
--     const params: string[] = [];
--     if (name && registrationNumber) {
--       query += ' WHERE "Name" = $1 AND "Registration number" = $2';
--       params.push(name as string, registrationNumber as string);
--     } else {
--       query += ' ORDER BY "Name" ASC';
--     }
--     const result = await pool.query(query, params);
--     res.json({ data: result.rows });
--   });
-- =============================================================================
