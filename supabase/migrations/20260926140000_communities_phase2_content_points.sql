-- VibeMatch Communities Phase 2: content, normal reactions, and trophy points.
-- Additive only. This migration creates new community tables/functions/policies;
-- it does not change Phase 1 tables or any existing app tables/data.
begin;

create table public.community_questions (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  anonymous_identity_id uuid not null,
  question_text text not null check (char_length(btrim(question_text)) between 1 and 2000),
  status text not null default 'active' check (status in ('active', 'hidden', 'removed')),
  moderated_by uuid references auth.users(id) on delete set null,
  moderated_at timestamptz,
  moderation_reason text check (moderation_reason is null or char_length(moderation_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_questions_identity_fkey foreign key (community_id, anonymous_identity_id)
    references public.community_anon_identities(community_id, id) on delete cascade,
  constraint community_questions_id_community_unique unique (id, community_id),
  constraint community_questions_moderation_metadata_check check (
    (moderated_at is null and moderated_by is null) or moderated_at is not null
  )
);
create index community_questions_feed_idx on public.community_questions (community_id, created_at desc, id) where status = 'active';
create index community_questions_author_idx on public.community_questions (community_id, anonymous_identity_id, created_at desc);

create table public.community_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null,
  community_id uuid not null,
  anonymous_identity_id uuid not null,
  answer_text text not null check (char_length(btrim(answer_text)) between 1 and 5000),
  status text not null default 'active' check (status in ('active', 'hidden', 'removed')),
  moderated_by uuid references auth.users(id) on delete set null,
  moderated_at timestamptz,
  moderation_reason text check (moderation_reason is null or char_length(moderation_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_answers_question_fkey foreign key (question_id, community_id)
    references public.community_questions(id, community_id) on delete cascade,
  constraint community_answers_identity_fkey foreign key (community_id, anonymous_identity_id)
    references public.community_anon_identities(community_id, id) on delete cascade,
  constraint community_answers_id_community_unique unique (id, community_id),
  constraint community_answers_moderation_metadata_check check (
    (moderated_at is null and moderated_by is null) or moderated_at is not null
  )
);
create index community_answers_question_feed_idx on public.community_answers (question_id, created_at, id) where status = 'active';
create index community_answers_author_idx on public.community_answers (community_id, anonymous_identity_id, created_at desc);

create table public.community_reactions (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null,
  question_id uuid,
  answer_id uuid,
  anonymous_identity_id uuid not null,
  -- Private anti-abuse key; never granted to API roles.
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  reaction_type text not null check (reaction_type in ('❤️', '😂', '🔥', '👍', '😮')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_reactions_one_content_check check (
    (question_id is not null and answer_id is null) or
    (question_id is null and answer_id is not null)
  ),
  constraint community_reactions_question_fkey foreign key (question_id, community_id)
    references public.community_questions(id, community_id) on delete cascade,
  constraint community_reactions_answer_fkey foreign key (answer_id, community_id)
    references public.community_answers(id, community_id) on delete cascade,
  constraint community_reactions_identity_fkey foreign key (community_id, anonymous_identity_id)
    references public.community_anon_identities(community_id, id) on delete cascade,
  constraint community_reactions_actor_membership_fkey foreign key (community_id, actor_user_id)
    references public.community_memberships(community_id, user_id) on delete cascade
);
-- One normal reaction per user/content; the RPC changes its type in place.
create unique index community_reactions_question_actor_key on public.community_reactions (question_id, actor_user_id) where question_id is not null;
create unique index community_reactions_answer_actor_key on public.community_reactions (answer_id, actor_user_id) where answer_id is not null;
create index community_reactions_question_idx on public.community_reactions (question_id, reaction_type) where question_id is not null;
create index community_reactions_answer_idx on public.community_reactions (answer_id, reaction_type) where answer_id is not null;

create table public.community_point_events (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null,
  question_id uuid,
  answer_id uuid,
  actor_identity_id uuid not null,
  -- Private real-user key used for anti-abuse and one-action uniqueness.
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  actor_role text not null check (actor_role in ('member', 'admin')),
  action_type text not null default 'trophy' check (action_type = 'trophy'),
  points_awarded smallint not null,
  created_at timestamptz not null default now(),
  constraint community_point_events_one_content_check check (
    (question_id is not null and answer_id is null) or
    (question_id is null and answer_id is not null)
  ),
  constraint community_point_events_award_amount_check check (
    (actor_role = 'member' and points_awarded in (0, 5)) or
    (actor_role = 'admin' and points_awarded = 10)
  ),
  constraint community_point_events_question_fkey foreign key (question_id, community_id)
    references public.community_questions(id, community_id) on delete cascade,
  constraint community_point_events_answer_fkey foreign key (answer_id, community_id)
    references public.community_answers(id, community_id) on delete cascade,
  constraint community_point_events_identity_fkey foreign key (community_id, actor_identity_id)
    references public.community_anon_identities(community_id, id) on delete cascade,
  constraint community_point_events_actor_membership_fkey foreign key (community_id, actor_user_id)
    references public.community_memberships(community_id, user_id) on delete cascade
);
-- One trophy action per actor/content; the admin's award is separate from the
-- cap on normal-user awards because actor_role and points_awarded are snapshotted.
create unique index community_point_events_question_actor_key on public.community_point_events (question_id, actor_user_id) where question_id is not null;
create unique index community_point_events_answer_actor_key on public.community_point_events (answer_id, actor_user_id) where answer_id is not null;
create unique index community_point_events_question_admin_once_key on public.community_point_events (question_id) where question_id is not null and actor_role = 'admin';
create unique index community_point_events_answer_admin_once_key on public.community_point_events (answer_id) where answer_id is not null and actor_role = 'admin';
create index community_point_events_question_day_idx on public.community_point_events (community_id, created_at, question_id) where question_id is not null and points_awarded > 0;
create index community_point_events_answer_day_idx on public.community_point_events (community_id, created_at, answer_id) where answer_id is not null and points_awarded > 0;

alter table public.community_questions enable row level security;
alter table public.community_answers enable row level security;
alter table public.community_reactions enable row level security;
alter table public.community_point_events enable row level security;

-- Context helpers always use auth.uid(); callers cannot ask about another user.
create function private.is_current_community_member(p_community_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.community_memberships m
    where m.community_id = p_community_id
      and m.user_id = (select auth.uid()) and m.status = 'active'
  );
$$;

create function private.is_current_community_moderator(p_community_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    (select private.is_admin()) or exists (
      select 1 from public.community_memberships m
      where m.community_id = p_community_id
        and m.user_id = (select auth.uid())
        and m.status = 'active' and m.role = 'admin'
    )
  );
$$;

create function private.can_read_community_content(
  p_community_id uuid, p_question_id uuid, p_answer_id uuid
)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  v_moderator boolean;
  v_community_status text;
  v_content_status text;
  v_parent_status text;
begin
  if (select auth.uid()) is null then return false; end if;
  v_moderator := private.is_current_community_moderator(p_community_id);
  if not v_moderator and not private.is_current_community_member(p_community_id) then
    return false;
  end if;
  select c.status into v_community_status
  from public.communities c where c.id = p_community_id;
  if not found or (v_community_status <> 'active' and not v_moderator) then
    return false;
  end if;

  if p_question_id is not null then
    select q.status into v_content_status
    from public.community_questions q
    where q.id = p_question_id and q.community_id = p_community_id;
    return found and (v_content_status = 'active' or v_moderator);
  elsif p_answer_id is not null then
    select a.status, q.status into v_content_status, v_parent_status
    from public.community_answers a
    join public.community_questions q
      on q.id = a.question_id and q.community_id = a.community_id
    where a.id = p_answer_id and a.community_id = p_community_id;
    return found and (
      (v_content_status = 'active' and v_parent_status = 'active') or v_moderator
    );
  end if;
  return false;
end;
$$;

create function private.require_active_community_member(
  p_community_id uuid, p_target_user_id uuid default null
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'Authentication is required'; end if;
  if not exists (
    select 1 from public.communities c
    where c.id = p_community_id and c.status = 'active'
  ) then raise exception 'Community is not active or does not exist'; end if;
  if not exists (
    select 1 from public.community_memberships m
    where m.community_id = p_community_id
      and m.user_id = v_user_id and m.status = 'active'
  ) then raise exception 'An active community membership is required'; end if;
  if p_target_user_id is not null and exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = v_user_id and b.blocked_user_id = p_target_user_id)
       or (b.blocker_id = p_target_user_id and b.blocked_user_id = v_user_id)
  ) then raise exception 'This interaction is unavailable because of a block'; end if;
  return v_user_id;
end;
$$;

create function private.set_community_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger community_questions_updated_at before update on public.community_questions
  for each row execute function private.set_community_updated_at();
create trigger community_answers_updated_at before update on public.community_answers
  for each row execute function private.set_community_updated_at();
create trigger community_reactions_updated_at before update on public.community_reactions
  for each row execute function private.set_community_updated_at();

-- Ensure private actor IDs match the existing Phase 1 anonymous mapping.
create function private.guard_community_actor_identity()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_mapped_user_id uuid;
begin
  if tg_table_name = 'community_reactions' then
    select i.user_id into v_mapped_user_id
    from public.community_anon_identities i
    where i.community_id = new.community_id and i.id = new.anonymous_identity_id;
  elsif tg_table_name = 'community_point_events' then
    select i.user_id into v_mapped_user_id
    from public.community_anon_identities i
    where i.community_id = new.community_id and i.id = new.actor_identity_id;
  else
    raise exception 'Unexpected table for community actor identity guard';
  end if;
  if not found or v_mapped_user_id is distinct from new.actor_user_id then
    raise exception 'Actor identity does not match the private user mapping';
  end if;
  return new;
end;
$$;
create trigger community_reactions_actor_identity_guard
  before insert or update on public.community_reactions
  for each row execute function private.guard_community_actor_identity();
create trigger community_point_events_actor_identity_guard
  before insert or update on public.community_point_events
  for each row execute function private.guard_community_actor_identity();

create function private.prevent_community_point_event_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Community point events cannot be edited';
end;
$$;
create trigger community_point_events_immutable
  before update on public.community_point_events
  for each row execute function private.prevent_community_point_event_mutation();

create function public.create_community_question(p_community_id uuid, p_question_text text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid;
  v_identity_id uuid;
  v_question_id uuid;
begin
  if char_length(btrim(coalesce(p_question_text, ''))) not between 1 and 2000 then
    raise exception 'Question text must contain 1 to 2000 characters';
  end if;
  v_user_id := private.require_active_community_member(p_community_id);
  select i.identity_id into v_identity_id
  from private.ensure_community_anon_identity(p_community_id, v_user_id) i;
  insert into public.community_questions (community_id, anonymous_identity_id, question_text)
  values (p_community_id, v_identity_id, btrim(p_question_text))
  returning id into v_question_id;
  return v_question_id;
end;
$$;

create function public.create_community_answer(
  p_community_id uuid, p_question_id uuid, p_answer_text text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid;
  v_identity_id uuid;
  v_question_author_id uuid;
  v_answer_id uuid;
begin
  if char_length(btrim(coalesce(p_answer_text, ''))) not between 1 and 5000 then
    raise exception 'Answer text must contain 1 to 5000 characters';
  end if;
  select i.user_id into v_question_author_id
  from public.community_questions q
  join public.community_anon_identities i
    on i.community_id = q.community_id and i.id = q.anonymous_identity_id
  where q.id = p_question_id and q.community_id = p_community_id and q.status = 'active'
  for update of q;
  if not found then raise exception 'Active question not found in this community'; end if;
  v_user_id := private.require_active_community_member(p_community_id, v_question_author_id);
  select i.identity_id into v_identity_id
  from private.ensure_community_anon_identity(p_community_id, v_user_id) i;
  insert into public.community_answers (
    question_id, community_id, anonymous_identity_id, answer_text
  ) values (p_question_id, p_community_id, v_identity_id, btrim(p_answer_text))
  returning id into v_answer_id;
  return v_answer_id;
end;
$$;

create function public.update_community_question(p_question_id uuid, p_question_text text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_community_id uuid;
  v_identity_id uuid;
  v_author_id uuid;
  v_user_id uuid;
begin
  if char_length(btrim(coalesce(p_question_text, ''))) not between 1 and 2000 then
    raise exception 'Question text must contain 1 to 2000 characters';
  end if;
  select q.community_id, q.anonymous_identity_id into v_community_id, v_identity_id
  from public.community_questions q
  where q.id = p_question_id and q.status = 'active' for update;
  if not found then raise exception 'Active question not found'; end if;
  select i.user_id into v_author_id from public.community_anon_identities i
  where i.community_id = v_community_id and i.id = v_identity_id;
  v_user_id := private.require_active_community_member(v_community_id);
  if v_author_id is distinct from v_user_id then
    raise exception 'Users can edit only their own questions';
  end if;
  update public.community_questions set question_text = btrim(p_question_text)
  where id = p_question_id;
end;
$$;

create function public.update_community_answer(p_answer_id uuid, p_answer_text text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_community_id uuid;
  v_identity_id uuid;
  v_author_id uuid;
  v_user_id uuid;
begin
  if char_length(btrim(coalesce(p_answer_text, ''))) not between 1 and 5000 then
    raise exception 'Answer text must contain 1 to 5000 characters';
  end if;
  select a.community_id, a.anonymous_identity_id into v_community_id, v_identity_id
  from public.community_answers a
  join public.community_questions q
    on q.id = a.question_id and q.community_id = a.community_id
  where a.id = p_answer_id and a.status = 'active' and q.status = 'active'
  for update of a;
  if not found then raise exception 'Active answer not found'; end if;
  select i.user_id into v_author_id from public.community_anon_identities i
  where i.community_id = v_community_id and i.id = v_identity_id;
  v_user_id := private.require_active_community_member(v_community_id);
  if v_author_id is distinct from v_user_id then
    raise exception 'Users can edit only their own answers';
  end if;
  update public.community_answers set answer_text = btrim(p_answer_text)
  where id = p_answer_id;
end;
$$;

create function public.moderate_community_content(
  p_content_type text, p_content_id uuid, p_status text, p_reason text default null
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_community_id uuid;
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'Authentication is required'; end if;
  if p_status not in ('active', 'hidden', 'removed') then
    raise exception 'Invalid moderation status';
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'Moderation reason must be 1000 characters or fewer';
  end if;
  if p_content_type = 'question' then
    select q.community_id into v_community_id
    from public.community_questions q where q.id = p_content_id for update;
  elsif p_content_type = 'answer' then
    select a.community_id into v_community_id
    from public.community_answers a where a.id = p_content_id for update;
  else raise exception 'Content type must be question or answer'; end if;
  if not found then raise exception 'Community content not found'; end if;
  if not private.is_current_community_moderator(v_community_id) then
    raise exception 'Only a community admin or platform admin can moderate content';
  end if;
  if p_content_type = 'question' then
    update public.community_questions
    set status = p_status, moderated_by = v_user_id, moderated_at = now(),
        moderation_reason = nullif(btrim(p_reason), '')
    where id = p_content_id;
  else
    update public.community_answers
    set status = p_status, moderated_by = v_user_id, moderated_at = now(),
        moderation_reason = nullif(btrim(p_reason), '')
    where id = p_content_id;
  end if;
end;
$$;

create function public.set_community_reaction(
  p_content_type text, p_content_id uuid, p_reaction_type text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_community_id uuid;
  v_target_identity_id uuid;
  v_target_user_id uuid;
  v_user_id uuid;
  v_identity_id uuid;
  v_reaction_id uuid;
begin
  if p_reaction_type not in ('❤️', '😂', '🔥', '👍', '😮') then
    raise exception 'Unsupported normal reaction';
  end if;
  if p_content_type = 'question' then
    select q.community_id, q.anonymous_identity_id into v_community_id, v_target_identity_id
    from public.community_questions q
    where q.id = p_content_id and q.status = 'active' for update;
  elsif p_content_type = 'answer' then
    select a.community_id, a.anonymous_identity_id into v_community_id, v_target_identity_id
    from public.community_answers a
    join public.community_questions q
      on q.id = a.question_id and q.community_id = a.community_id
    where a.id = p_content_id and a.status = 'active' and q.status = 'active'
    for update of a;
  else raise exception 'Content type must be question or answer'; end if;
  if not found then raise exception 'Active community content not found'; end if;
  select i.user_id into v_target_user_id from public.community_anon_identities i
  where i.community_id = v_community_id and i.id = v_target_identity_id;
  v_user_id := private.require_active_community_member(v_community_id, v_target_user_id);
  select i.identity_id into v_identity_id
  from private.ensure_community_anon_identity(v_community_id, v_user_id) i;

  if p_content_type = 'question' then
    insert into public.community_reactions (
      community_id, question_id, anonymous_identity_id, actor_user_id, reaction_type
    ) values (v_community_id, p_content_id, v_identity_id, v_user_id, p_reaction_type)
    on conflict (question_id, actor_user_id) where question_id is not null
    do update set reaction_type = excluded.reaction_type, updated_at = now()
    returning id into v_reaction_id;
  else
    insert into public.community_reactions (
      community_id, answer_id, anonymous_identity_id, actor_user_id, reaction_type
    ) values (v_community_id, p_content_id, v_identity_id, v_user_id, p_reaction_type)
    on conflict (answer_id, actor_user_id) where answer_id is not null
    do update set reaction_type = excluded.reaction_type, updated_at = now()
    returning id into v_reaction_id;
  end if;
  return v_reaction_id;
end;
$$;

create function public.remove_community_reaction(p_reaction_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_community_id uuid;
  v_question_id uuid;
  v_answer_id uuid;
  v_target_identity_id uuid;
  v_target_user_id uuid;
  v_user_id uuid := (select auth.uid());
begin
  select r.community_id, r.question_id, r.answer_id, r.anonymous_identity_id
  into v_community_id, v_question_id, v_answer_id, v_target_identity_id
  from public.community_reactions r
  where r.id = p_reaction_id and r.actor_user_id = v_user_id for update;
  if not found then raise exception 'Your reaction was not found'; end if;
  select i.user_id into v_target_user_id from public.community_anon_identities i
  where i.community_id = v_community_id and i.id = v_target_identity_id;
  perform private.require_active_community_member(v_community_id, v_target_user_id);
  if not private.can_read_community_content(v_community_id, v_question_id, v_answer_id) then
    raise exception 'Community content is no longer available';
  end if;
  delete from public.community_reactions
  where id = p_reaction_id and actor_user_id = v_user_id;
end;
$$;

create function public.award_community_trophy(p_content_type text, p_content_id uuid)
returns smallint language plpgsql security definer set search_path = ''
as $$
declare
  v_community_id uuid;
  v_target_identity_id uuid;
  v_target_user_id uuid;
  v_user_id uuid;
  v_identity_id uuid;
  v_role text;
  v_awarded smallint;
  v_prior_normal_awards integer;
begin
  -- Lock the content row so concurrent trophy requests serialize per item.
  if p_content_type = 'question' then
    select q.community_id, q.anonymous_identity_id into v_community_id, v_target_identity_id
    from public.community_questions q
    where q.id = p_content_id and q.status = 'active' for update;
  elsif p_content_type = 'answer' then
    select a.community_id, a.anonymous_identity_id into v_community_id, v_target_identity_id
    from public.community_answers a
    join public.community_questions q
      on q.id = a.question_id and q.community_id = a.community_id
    where a.id = p_content_id and a.status = 'active' and q.status = 'active'
    for update of a;
  else raise exception 'Content type must be question or answer'; end if;
  if not found then raise exception 'Active community content not found'; end if;
  select i.user_id into v_target_user_id from public.community_anon_identities i
  where i.community_id = v_community_id and i.id = v_target_identity_id;
  v_user_id := private.require_active_community_member(v_community_id, v_target_user_id);
  if v_user_id = v_target_user_id then
    raise exception 'Users cannot award trophy points to their own content';
  end if;
  select m.role into v_role from public.community_memberships m
  where m.community_id = v_community_id and m.user_id = v_user_id and m.status = 'active';
  select i.identity_id into v_identity_id
  from private.ensure_community_anon_identity(v_community_id, v_user_id) i;

  if p_content_type = 'question' then
    if exists (select 1 from public.community_point_events e
      where e.question_id = p_content_id and e.actor_user_id = v_user_id) then
      raise exception 'You have already given a trophy to this content';
    end if;
    if v_role = 'admin' then
      if exists (select 1 from public.community_point_events e
        where e.question_id = p_content_id and e.actor_role = 'admin') then
        raise exception 'A community admin trophy has already been awarded to this content';
      end if;
      v_awarded := 10;
    else
      select count(*) into v_prior_normal_awards
      from public.community_point_events e
      where e.question_id = p_content_id and e.actor_role = 'member'
        and e.points_awarded = 5;
      v_awarded := case when v_prior_normal_awards < 3 then 5 else 0 end;
    end if;
    insert into public.community_point_events (
      community_id, question_id, actor_identity_id, actor_user_id, actor_role, points_awarded
    ) values (v_community_id, p_content_id, v_identity_id, v_user_id, v_role, v_awarded);
  else
    if exists (select 1 from public.community_point_events e
      where e.answer_id = p_content_id and e.actor_user_id = v_user_id) then
      raise exception 'You have already given a trophy to this content';
    end if;
    if v_role = 'admin' then
      if exists (select 1 from public.community_point_events e
        where e.answer_id = p_content_id and e.actor_role = 'admin') then
        raise exception 'A community admin trophy has already been awarded to this content';
      end if;
      v_awarded := 10;
    else
      select count(*) into v_prior_normal_awards
      from public.community_point_events e
      where e.answer_id = p_content_id and e.actor_role = 'member'
        and e.points_awarded = 5;
      v_awarded := case when v_prior_normal_awards < 3 then 5 else 0 end;
    end if;
    insert into public.community_point_events (
      community_id, answer_id, actor_identity_id, actor_user_id, actor_role, points_awarded
    ) values (v_community_id, p_content_id, v_identity_id, v_user_id, v_role, v_awarded);
  end if;
  return v_awarded;
end;
$$;

-- UTC QOTD score sums only positive trophy-ledger points attached directly to
-- the question. Answer points and emoji reactions are never included. Ties go
-- to the earliest-created question, then UUID for a stable final ordering.
-- No permanent QOTD table is needed.
create function public.get_community_question_of_day(
  p_community_id uuid, p_utc_day date default ((now() at time zone 'UTC')::date)
)
returns table (
  question_id uuid, community_id uuid, anonymous_identity_id uuid,
  question_text text, created_at timestamptz, trophy_points bigint
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_start timestamptz := (p_utc_day::timestamp at time zone 'UTC');
  v_end timestamptz := ((p_utc_day + 1)::timestamp at time zone 'UTC');
begin
  perform private.require_active_community_member(p_community_id);
  return query
  select q.id, q.community_id, q.anonymous_identity_id, q.question_text,
         q.created_at, coalesce(sum(e.points_awarded), 0)::bigint
  from public.community_questions q
  left join public.community_point_events e
    on e.community_id = q.community_id
   and e.question_id = q.id
   and e.answer_id is null
   and e.created_at >= v_start and e.created_at < v_end
   and e.points_awarded > 0
  where q.community_id = p_community_id and q.status = 'active'
  group by q.id, q.community_id, q.anonymous_identity_id, q.question_text, q.created_at
  order by coalesce(sum(e.points_awarded), 0) desc, q.created_at asc, q.id asc
  limit 1;
end;
$$;

create policy "Active members and moderators can read community questions"
  on public.community_questions for select to authenticated
  using (private.can_read_community_content(community_id, id, null));
create policy "Active members and moderators can read community answers"
  on public.community_answers for select to authenticated
  using (private.can_read_community_content(community_id, null, id));
create policy "Active members and moderators can read normal reactions"
  on public.community_reactions for select to authenticated
  using (private.can_read_community_content(community_id, question_id, answer_id));
create policy "Active members and moderators can read point events"
  on public.community_point_events for select to authenticated
  using (private.can_read_community_content(community_id, question_id, answer_id));

-- Browser roles can read anonymous fields only. All writes go through RPCs.
revoke all on table public.community_questions from public, anon, authenticated;
revoke all on table public.community_answers from public, anon, authenticated;
revoke all on table public.community_reactions from public, anon, authenticated;
revoke all on table public.community_point_events from public, anon, authenticated;
grant select (id, community_id, anonymous_identity_id, question_text, status, created_at, updated_at)
  on public.community_questions to authenticated;
grant select (id, question_id, community_id, anonymous_identity_id, answer_text, status, created_at, updated_at)
  on public.community_answers to authenticated;
grant select (id, community_id, question_id, answer_id, anonymous_identity_id, reaction_type, created_at, updated_at)
  on public.community_reactions to authenticated;
grant select (id, community_id, question_id, answer_id, actor_identity_id, actor_role, action_type, points_awarded, created_at)
  on public.community_point_events to authenticated;

revoke all on function private.is_current_community_member(uuid) from public, anon, authenticated;
revoke all on function private.is_current_community_moderator(uuid) from public, anon, authenticated;
revoke all on function private.can_read_community_content(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.require_active_community_member(uuid, uuid) from public, anon, authenticated;
revoke all on function private.set_community_updated_at() from public, anon, authenticated;
revoke all on function private.guard_community_actor_identity() from public, anon, authenticated;
revoke all on function private.prevent_community_point_event_mutation() from public, anon, authenticated;
grant execute on function private.is_current_community_member(uuid) to authenticated;
grant execute on function private.is_current_community_moderator(uuid) to authenticated;
grant execute on function private.can_read_community_content(uuid, uuid, uuid) to authenticated;

revoke all on function public.create_community_question(uuid, text) from public, anon, authenticated;
revoke all on function public.create_community_answer(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.update_community_question(uuid, text) from public, anon, authenticated;
revoke all on function public.update_community_answer(uuid, text) from public, anon, authenticated;
revoke all on function public.moderate_community_content(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.set_community_reaction(text, uuid, text) from public, anon, authenticated;
revoke all on function public.remove_community_reaction(uuid) from public, anon, authenticated;
revoke all on function public.award_community_trophy(text, uuid) from public, anon, authenticated;
revoke all on function public.get_community_question_of_day(uuid, date) from public, anon, authenticated;
grant execute on function public.create_community_question(uuid, text) to authenticated;
grant execute on function public.create_community_answer(uuid, uuid, text) to authenticated;
grant execute on function public.update_community_question(uuid, text) to authenticated;
grant execute on function public.update_community_answer(uuid, text) to authenticated;
grant execute on function public.moderate_community_content(text, uuid, text, text) to authenticated;
grant execute on function public.set_community_reaction(text, uuid, text) to authenticated;
grant execute on function public.remove_community_reaction(uuid) to authenticated;
grant execute on function public.award_community_trophy(text, uuid) to authenticated;
grant execute on function public.get_community_question_of_day(uuid, date) to authenticated;

commit;
