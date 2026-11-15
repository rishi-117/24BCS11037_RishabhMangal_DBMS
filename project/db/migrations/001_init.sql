-- =============================================================================
-- Migration 001 — initial relational schema
-- Mirrors db/schema.sql exactly; the migration runner records applied versions
-- in schema_migrations so `npm run db:migrate` is idempotent.
-- =============================================================================

CREATE TYPE user_role      AS ENUM ('member', 'trainer', 'admin');
CREATE TYPE trainer_status AS ENUM ('pending', 'approved', 'rejected', 'revoked');
CREATE TYPE presence_status AS ENUM ('IN', 'OUT');
CREATE TYPE gate_action    AS ENUM ('CHECK-IN', 'CHECK-OUT');
CREATE TYPE payment_kind   AS ENUM ('MEMBERSHIP_PURCHASE', 'MEMBERSHIP_RENEWAL');

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  username      text,
  name          text NOT NULL,
  phone         text,
  password_hash text NOT NULL,
  role          user_role NOT NULL DEFAULT 'member',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT users_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT users_email_shape   CHECK (position('@' in email) > 1),
  CONSTRAINT users_username_shape CHECK (username IS NULL OR username ~ '^[a-zA-Z0-9._-]{3,32}$')
);

CREATE UNIQUE INDEX users_email_unique    ON users (lower(email));
CREATE UNIQUE INDEX users_username_unique ON users (lower(username)) WHERE username IS NOT NULL;
CREATE INDEX        users_role_idx        ON users (role);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE membership_plans (
  id              serial PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  tier            text NOT NULL,
  price_inr       numeric(10,2) NOT NULL,
  duration_months smallint NOT NULL,
  description     text NOT NULL DEFAULT '',
  features        text[] NOT NULL DEFAULT '{}',

  CONSTRAINT membership_plans_price_non_negative CHECK (price_inr >= 0),
  CONSTRAINT membership_plans_duration_positive   CHECK (duration_months > 0)
);

CREATE TABLE memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id    integer NOT NULL REFERENCES membership_plans(id) ON DELETE RESTRICT,
  start_date date NOT NULL,
  end_date   date NOT NULL,
  price_paid numeric(10,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT memberships_period_valid  CHECK (end_date > start_date),
  CONSTRAINT memberships_price_valid   CHECK (price_paid >= 0)
);

CREATE INDEX memberships_user_end_idx ON memberships (user_id, end_date DESC);

CREATE TRIGGER memberships_set_updated_at
  BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_activity (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_status  presence_status NOT NULL DEFAULT 'OUT',
  total_sessions  integer NOT NULL DEFAULT 0,
  last_active     timestamptz,
  last_check_in   timestamptz,

  CONSTRAINT user_activity_sessions_non_negative CHECK (total_sessions >= 0)
);

CREATE INDEX user_activity_presence_idx ON user_activity (current_status)
  WHERE current_status = 'IN';

CREATE TABLE member_profiles (
  user_id             uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  assigned_trainer_id uuid REFERENCES users(id) ON DELETE SET NULL,
  rating              smallint,
  trainer_notes       text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT member_profiles_rating_range CHECK (rating IS NULL OR rating BETWEEN 0 AND 10),
  CONSTRAINT member_profiles_not_self_coach CHECK (assigned_trainer_id IS NULL OR assigned_trainer_id <> user_id)
);

CREATE INDEX member_profiles_trainer_idx ON member_profiles (assigned_trainer_id);

CREATE TABLE trainer_profiles (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  specialization text NOT NULL DEFAULT 'General Fitness',
  experience     text NOT NULL DEFAULT 'Certified Trainer',
  status         trainer_status NOT NULL DEFAULT 'pending',
  requested_at   timestamptz NOT NULL DEFAULT now(),
  approved_at    timestamptz,
  rejected_at    timestamptz,
  revoked_at     timestamptz,
  joining_date   timestamptz,

  CONSTRAINT trainer_profiles_approved_has_date
    CHECK (status <> 'approved' OR approved_at IS NOT NULL)
);

CREATE INDEX trainer_profiles_status_idx ON trainer_profiles (status);

CREATE TABLE gate_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        user_role NOT NULL,
  action      gate_action NOT NULL,
  gym_id      text NOT NULL DEFAULT 'AURA_CLUB_MAIN_ENTRANCE',
  source      text NOT NULL DEFAULT 'MEMBER_TERMINAL',
  occurred_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT gate_logs_known_gym
    CHECK (gym_id IN ('AURA_CLUB_MAIN_ENTRANCE', 'AURA_CLUB_FLOOR_2'))
);

CREATE INDEX gate_logs_occurred_idx      ON gate_logs (occurred_at DESC);
CREATE INDEX gate_logs_user_occurred_idx ON gate_logs (user_id, occurred_at DESC);
CREATE INDEX gate_logs_checkins_idx      ON gate_logs (user_id, occurred_at DESC) WHERE action = 'CHECK-IN';

CREATE TABLE expenses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category   text NOT NULL,
  amount     numeric(10,2) NOT NULL,
  spent_at   timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT expenses_category_not_blank CHECK (length(btrim(category)) > 0),
  CONSTRAINT expenses_amount_non_negative CHECK (amount >= 0)
);

CREATE INDEX expenses_spent_at_idx ON expenses (spent_at DESC);

CREATE TABLE payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
  amount        numeric(10,2) NOT NULL,
  months        smallint NOT NULL,
  kind          payment_kind NOT NULL DEFAULT 'MEMBERSHIP_RENEWAL',
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payments_amount_non_negative CHECK (amount >= 0),
  CONSTRAINT payments_months_positive      CHECK (months > 0)
);

CREATE INDEX payments_user_idx    ON payments (user_id, created_at DESC);
CREATE INDEX payments_created_idx ON payments (created_at DESC);

CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sessions_expiry_future CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_idx    ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
