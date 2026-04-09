-- Seed staff invite tokens
-- Run this against your Neon Postgres database to create invite tokens for staff members.
-- Replace the email addresses as needed.
-- After running, share the setup URL with each staff member:
--   https://thebespokecar.com/setup-staff.html?token=<token>

INSERT INTO staff_invites (email, token, role, expires_at)
VALUES
  (
    'staff1@thebespokecar.com',
    encode(gen_random_bytes(32), 'hex'),
    'staff',
    now() + interval '7 days'
  ),
  (
    'staff2@thebespokecar.com',
    encode(gen_random_bytes(32), 'hex'),
    'staff',
    now() + interval '7 days'
  )
ON CONFLICT (email) DO UPDATE
  SET token = encode(gen_random_bytes(32), 'hex'),
      used = FALSE,
      expires_at = now() + interval '7 days';

-- View the tokens after inserting:
SELECT email, token, role, expires_at FROM staff_invites;
