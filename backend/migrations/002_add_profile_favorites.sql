ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS favorites JSONB
NOT NULL DEFAULT '[]'::jsonb;