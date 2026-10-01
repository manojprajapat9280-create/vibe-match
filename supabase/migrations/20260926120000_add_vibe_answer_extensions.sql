-- Additive onboarding storage for Q8 and Q9.
-- Existing vibe_answers rows and their matching triggers are intentionally untouched.
create table if not exists public.vibe_answer_extensions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  q8 smallint not null check (q8 between 1 and 6),
  q9_answer text check (q9_answer is null or char_length(q9_answer) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vibe_answer_extensions enable row level security;

create policy "Users can read own onboarding extensions"
  on public.vibe_answer_extensions
  for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own onboarding extensions"
  on public.vibe_answer_extensions
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own onboarding extensions"
  on public.vibe_answer_extensions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
