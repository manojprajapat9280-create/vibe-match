-- VibeMatch Communities Phase 1: requests, approved communities, memberships,
-- and private per-community anonymous identity mappings.
-- Additive only: this migration does not alter existing tables or data.
begin;

create table public.community_creation_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid default auth.uid()
    references auth.users(id) on delete set null,
  name text not null
    check (name = btrim(name) and char_length(name) between 3 and 80),
  description text not null
    check (char_length(btrim(description)) between 1 and 2000),
  category text not null check (category in (
    'startup_entrepreneurship',
    'coding_technology',
    'gaming',
    'music',
    'study',
    'fitness',
    'movies',
    'art',
    'other'
  )),
  reason text not null
    check (char_length(btrim(reason)) between 1 and 2000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_note text
    check (rejection_note is null or char_length(rejection_note) <= 1000),
  constraint community_request_review_metadata_check check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_at is not null)
  ),
  constraint community_request_rejection_note_check check (
    status = 'rejected' or rejection_note is null
  )
);

create unique index community_creation_requests_pending_name_key
  on public.community_creation_requests (lower(btrim(name)))
  where status = 'pending';

create index community_creation_requests_requester_submitted_idx
  on public.community_creation_requests (requester_id, submitted_at desc);

create index community_creation_requests_status_submitted_idx
  on public.community_creation_requests (status, submitted_at desc);

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null
    check (name = btrim(name) and char_length(name) between 3 and 80),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  description text not null
    check (char_length(btrim(description)) between 1 and 2000),
  category text not null check (category in (
    'startup_entrepreneurship',
    'coding_technology',
    'gaming',
    'music',
    'study',
    'fitness',
    'movies',
    'art',
    'other'
  )),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  approved_request_id uuid not null unique
    references public.community_creation_requests(id) on delete restrict,
  owner_admin_id uuid not null
    references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index communities_active_category_created_idx
  on public.communities (category, created_at desc)
  where status = 'active';

create index communities_owner_admin_idx
  on public.communities (owner_admin_id);

create table public.community_memberships (
  community_id uuid not null
    references public.communities(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  role text not null default 'member'
    check (role in ('member', 'admin')),
  status text not null default 'active'
    check (status in ('active', 'left', 'removed')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (community_id, user_id),
  constraint community_membership_left_at_check check (
    (status = 'active' and left_at is null)
    or (status in ('left', 'removed') and left_at is not null)
  )
);

create index community_memberships_user_status_idx
  on public.community_memberships (user_id, status, community_id);

create index community_memberships_community_status_idx
  on public.community_memberships (community_id, status);

create table public.community_anon_identities (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null,
  user_id uuid not null,
  alias_number integer not null check (alias_number > 0),
  created_at timestamptz not null default now(),
  constraint community_anon_identity_member_fkey
    foreign key (community_id, user_id)
    references public.community_memberships(community_id, user_id)
    on delete cascade,
  constraint community_anon_identity_user_unique
    unique (community_id, user_id),
  constraint community_anon_identity_alias_unique
    unique (community_id, alias_number),
  constraint community_anon_identity_id_community_unique
    unique (community_id, id)
);

alter table public.community_creation_requests enable row level security;
alter table public.communities enable row level security;
alter table public.community_memberships enable row level security;
alter table public.community_anon_identities enable row level security;

create policy "Requesters and platform admins can read community requests"
  on public.community_creation_requests
  for select to authenticated
  using (requester_id = (select auth.uid()) or (select private.is_admin()));

create policy "Authenticated users can submit their own pending requests"
  on public.community_creation_requests
  for insert to authenticated
  with check (
    requester_id = (select auth.uid())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
  );

create policy "Users can discover active communities and admins can inspect all"
  on public.communities
  for select to authenticated
  using (status = 'active' or (select private.is_admin()));

create policy "Users can read their own membership and admins can inspect memberships"
  on public.community_memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

create policy "Only platform admins can read identity mappings"
  on public.community_anon_identities
  for select to authenticated
  using ((select private.is_admin()));

-- Remove default API access on these new tables, then grant only the safe
-- read/write surface. Existing tables and grants are untouched.
revoke all on table public.community_creation_requests from public, anon, authenticated;
revoke all on table public.communities from public, anon, authenticated;
revoke all on table public.community_memberships from public, anon, authenticated;
revoke all on table public.community_anon_identities from public, anon, authenticated;

grant select, insert on table public.community_creation_requests to authenticated;
grant select (id, name, slug, description, category, status, created_at, updated_at)
  on table public.communities to authenticated;
grant select (community_id, role, status, joined_at, left_at)
  on table public.community_memberships to authenticated;
-- No direct API privileges are granted on the identity-to-user mapping table.

create function private.ensure_community_anon_identity(
  p_community_id uuid,
  p_user_id uuid
)
returns table (identity_id uuid, alias_number integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity_id uuid;
  v_alias_number integer;
  v_locked_community_id uuid;
begin
  if p_user_id is null then
    raise exception 'A user is required to create a community identity';
  end if;

  select c.id into v_locked_community_id
  from public.communities c
  where c.id = p_community_id
    and c.status = 'active'
  for update;

  if not found then
    raise exception 'Community is not active';
  end if;

  if not exists (
    select 1
    from public.community_memberships m
    where m.community_id = p_community_id
      and m.user_id = p_user_id
      and m.status = 'active'
  ) then
    raise exception 'An active community membership is required';
  end if;

  select i.id, i.alias_number
    into v_identity_id, v_alias_number
  from public.community_anon_identities i
  where i.community_id = p_community_id
    and i.user_id = p_user_id;

  if found then
    return query select v_identity_id, v_alias_number;
    return;
  end if;

  select coalesce(max(i.alias_number), 0) + 1
    into v_alias_number
  from public.community_anon_identities i
  where i.community_id = p_community_id;

  insert into public.community_anon_identities (
    community_id,
    user_id,
    alias_number
  ) values (
    p_community_id,
    p_user_id,
    v_alias_number
  )
  returning id into v_identity_id;

  return query select v_identity_id, v_alias_number;
end;
$$;

create function public.approve_community_creation_request(
  p_request_id uuid,
  p_slug text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid;
  v_request public.community_creation_requests%rowtype;
  v_community_id uuid;
begin
  v_admin_id := (select auth.uid());
  if v_admin_id is null or not (select private.is_admin()) then
    raise exception 'Only a VibeMatch platform admin can approve requests';
  end if;

  select r.* into v_request
  from public.community_creation_requests r
  where r.id = p_request_id
  for update;

  if not found then
    raise exception 'Community request not found';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only pending community requests can be approved';
  end if;

  update public.community_creation_requests
  set status = 'approved',
      reviewed_by = v_admin_id,
      reviewed_at = now(),
      rejection_note = null
  where id = p_request_id;

  insert into public.communities (
    name,
    slug,
    description,
    category,
    status,
    approved_request_id,
    owner_admin_id,
    created_at,
    updated_at
  ) values (
    v_request.name,
    lower(btrim(p_slug)),
    v_request.description,
    v_request.category,
    'active',
    v_request.id,
    v_admin_id,
    now(),
    now()
  )
  returning id into v_community_id;

  insert into public.community_memberships (
    community_id, user_id, role, status
  ) values (
    v_community_id, v_admin_id, 'admin', 'active'
  );

  if v_request.requester_id is not null
     and v_request.requester_id <> v_admin_id then
    insert into public.community_memberships (
      community_id, user_id, role, status
    ) values (
      v_community_id, v_request.requester_id, 'member', 'active'
    );
  end if;

  perform 1 from private.ensure_community_anon_identity(v_community_id, v_admin_id);
  if v_request.requester_id is not null
     and v_request.requester_id <> v_admin_id then
    perform 1 from private.ensure_community_anon_identity(
      v_community_id, v_request.requester_id
    );
  end if;

  return v_community_id;
end;
$$;

create function public.reject_community_creation_request(
  p_request_id uuid,
  p_rejection_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid;
  v_request_status text;
begin
  v_admin_id := (select auth.uid());
  if v_admin_id is null or not (select private.is_admin()) then
    raise exception 'Only a VibeMatch platform admin can reject requests';
  end if;

  if p_rejection_note is not null and char_length(p_rejection_note) > 1000 then
    raise exception 'Rejection note must be 1000 characters or fewer';
  end if;

  select r.status into v_request_status
  from public.community_creation_requests r
  where r.id = p_request_id
  for update;

  if not found then
    raise exception 'Community request not found';
  end if;
  if v_request_status <> 'pending' then
    raise exception 'Only pending community requests can be rejected';
  end if;

  update public.community_creation_requests
  set status = 'rejected',
      reviewed_by = v_admin_id,
      reviewed_at = now(),
      rejection_note = nullif(btrim(p_rejection_note), '')
  where id = p_request_id;
end;
$$;

create function public.join_community(p_community_id uuid)
returns table (identity_id uuid, alias_number integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_membership_role text;
  v_membership_status text;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Authentication is required to join a community';
  end if;

  perform 1
  from public.communities c
  where c.id = p_community_id
    and c.status = 'active'
  for update;

  if not found then
    raise exception 'Community is not active or does not exist';
  end if;

  select m.role, m.status
    into v_membership_role, v_membership_status
  from public.community_memberships m
  where m.community_id = p_community_id
    and m.user_id = v_user_id
  for update;

  if found then
    if v_membership_status = 'removed' then
      raise exception 'This membership has been removed';
    elsif v_membership_status = 'left' and v_membership_role = 'member' then
      update public.community_memberships
      set status = 'active', joined_at = now(), left_at = null
      where community_id = p_community_id and user_id = v_user_id;
    elsif v_membership_status <> 'active' then
      raise exception 'This membership cannot be reactivated';
    end if;
  else
    insert into public.community_memberships (
      community_id, user_id, role, status
    ) values (
      p_community_id, v_user_id, 'member', 'active'
    );
  end if;

  return query
    select i.identity_id, i.alias_number
    from private.ensure_community_anon_identity(p_community_id, v_user_id) i;
end;
$$;

create function public.leave_community(p_community_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_membership_role text;
  v_membership_status text;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Authentication is required to leave a community';
  end if;

  select m.role, m.status
    into v_membership_role, v_membership_status
  from public.community_memberships m
  where m.community_id = p_community_id
    and m.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Community membership not found';
  end if;
  if v_membership_role <> 'member' then
    raise exception 'Community admins must be reassigned before leaving';
  end if;
  if v_membership_status = 'removed' then
    raise exception 'This membership has been removed';
  end if;

  if v_membership_status = 'active' then
    update public.community_memberships
    set status = 'left', left_at = now()
    where community_id = p_community_id and user_id = v_user_id;
  end if;
end;
$$;

create function public.get_my_community_identity(p_community_id uuid)
returns table (identity_id uuid, alias_number integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  return query
    select i.identity_id, i.alias_number
    from private.ensure_community_anon_identity(p_community_id, v_user_id) i;
end;
$$;

create function public.resolve_community_anon_identity(
  p_community_id uuid,
  p_identity_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if (select auth.uid()) is null or not (select private.is_admin()) then
    raise exception 'Only a VibeMatch platform admin can resolve identities';
  end if;

  select i.user_id into v_user_id
  from public.community_anon_identities i
  where i.community_id = p_community_id
    and i.id = p_identity_id;

  if not found then
    raise exception 'Community identity not found';
  end if;

  return v_user_id;
end;
$$;

revoke all on function private.ensure_community_anon_identity(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.approve_community_creation_request(uuid, text)
  from public, anon, authenticated;
revoke all on function public.reject_community_creation_request(uuid, text)
  from public, anon, authenticated;
revoke all on function public.join_community(uuid)
  from public, anon, authenticated;
revoke all on function public.leave_community(uuid)
  from public, anon, authenticated;
revoke all on function public.get_my_community_identity(uuid)
  from public, anon, authenticated;
revoke all on function public.resolve_community_anon_identity(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.approve_community_creation_request(uuid, text)
  to authenticated;
grant execute on function public.reject_community_creation_request(uuid, text)
  to authenticated;
grant execute on function public.join_community(uuid)
  to authenticated;
grant execute on function public.leave_community(uuid)
  to authenticated;
grant execute on function public.get_my_community_identity(uuid)
  to authenticated;
grant execute on function public.resolve_community_anon_identity(uuid, uuid)
  to authenticated;

commit;
