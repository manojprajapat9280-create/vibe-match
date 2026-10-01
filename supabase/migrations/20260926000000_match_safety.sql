-- Persistent safety actions for VibeMatch. Apply with `supabase db push`.
create table if not exists public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_blocks_not_self check (blocker_id <> blocked_user_id),
  constraint user_blocks_unique_pair unique (blocker_id, blocked_user_id)
);

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid references public.matches(id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now(),
  constraint user_reports_not_self check (reporter_id <> reported_user_id)
);

alter table public.user_blocks enable row level security;
alter table public.user_reports enable row level security;

drop policy if exists "Users can view blocks involving them" on public.user_blocks;
create policy "Users can view blocks involving them"
  on public.user_blocks for select to authenticated
  using (auth.uid() = blocker_id or auth.uid() = blocked_user_id);

drop policy if exists "Users can block others" on public.user_blocks;
create policy "Users can block others"
  on public.user_blocks for insert to authenticated
  with check (auth.uid() = blocker_id and blocker_id <> blocked_user_id);

drop policy if exists "Users can submit reports" on public.user_reports;
create policy "Users can submit reports"
  on public.user_reports for insert to authenticated
  with check (auth.uid() = reporter_id and reporter_id <> reported_user_id);

-- Only the reporting user can inspect their own report; no browser-side access
-- exposes reports submitted by other students.
drop policy if exists "Users can view their reports" on public.user_reports;
create policy "Users can view their reports"
  on public.user_reports for select to authenticated
  using (auth.uid() = reporter_id);

create or replace function public.reject_messages_between_blocked_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sender uuid;
  recipient uuid;
begin
  select user1_id, user2_id into sender, recipient
  from public.matches
  where id = new.match_id;

  if sender is null then
    return new;
  end if;

  if (sender = new.sender_id or recipient = new.sender_id) and exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = sender and b.blocked_user_id = recipient)
       or (b.blocker_id = recipient and b.blocked_user_id = sender)
  ) then
    raise exception 'Messaging is unavailable for this match';
  end if;

  return new;
end;
$$;

drop trigger if exists reject_messages_between_blocked_users on public.messages;
create trigger reject_messages_between_blocked_users
  before insert on public.messages
  for each row execute function public.reject_messages_between_blocked_users();
