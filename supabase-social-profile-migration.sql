-- Run once in Supabase SQL Editor after the original supabase-setup.sql has been applied.
-- Safe to re-run: columns, tables, indexes, and policies are guarded or replaced.

-- LightJurnal v2: public discussion, per-journal comments, and editable profiles.
alter table public.profiles
  add column if not exists bio text not null default '',
  add column if not exists avatar_url text,
  add column if not exists updated_at timestamptz not null default now();

grant update (display_name, bio, avatar_url) on public.profiles to authenticated;
drop policy if exists "Users update their own profile" on public.profiles;
create policy "Users update their own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid references public.journals(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null default '',
  author_avatar text,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists comments_journal_created_idx
  on public.comments (journal_id, created_at desc);
create index if not exists comments_author_created_idx
  on public.comments (author_id, created_at desc);

alter table public.comments enable row level security;
grant select on public.comments to anon, authenticated;
grant insert, delete on public.comments to authenticated;

drop policy if exists "Read public discussion and approved journal comments" on public.comments;
create policy "Read public discussion and approved journal comments"
on public.comments for select
to anon, authenticated
using (
  journal_id is null
  or exists (
    select 1 from public.journals j
    where j.id = comments.journal_id and j.status = 'approved'
  )
);

drop policy if exists "Signed-in users comment as themselves" on public.comments;
create policy "Signed-in users comment as themselves"
on public.comments for insert
to authenticated
with check (
  author_id = auth.uid()
  and char_length(btrim(body)) between 1 and 2000
  and (
    journal_id is null
    or exists (
      select 1 from public.journals j
      where j.id = comments.journal_id and j.status = 'approved'
    )
  )
);

drop policy if exists "Users delete their own comments or admin moderates" on public.comments;
create policy "Users delete their own comments or admin moderates"
on public.comments for delete
to authenticated
using (author_id = auth.uid() or private.is_admin());

create or replace function private.prepare_lightjurnal_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or new.author_id <> auth.uid() then
    raise exception 'Kamu harus masuk dengan akun LightJurnal untuk berkomentar.';
  end if;
  new.body := btrim(new.body);
  select
    coalesce(nullif(btrim(p.display_name), ''), nullif(split_part(coalesce(p.email, ''), '@', 1), ''), 'Pengguna LightJurnal'),
    p.avatar_url
  into new.author_name, new.author_avatar
  from public.profiles p
  where p.id = new.author_id;
  new.author_name := coalesce(nullif(btrim(new.author_name), ''), 'Pengguna LightJurnal');
  return new;
end;
$$;
revoke all on function private.prepare_lightjurnal_comment() from public, anon, authenticated;
drop trigger if exists prepare_lightjurnal_comment on public.comments;
create trigger prepare_lightjurnal_comment
before insert on public.comments
for each row execute function private.prepare_lightjurnal_comment();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', true, 2000000, array['image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update
set public = true,
    file_size_limit = 2000000,
    allowed_mime_types = array['image/jpeg','image/png','image/webp']::text[];

drop policy if exists "Upload own profile avatar" on storage.objects;
create policy "Upload own profile avatar"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists "Delete own profile avatar" on storage.objects;
create policy "Delete own profile avatar"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Enable live comment updates when the Supabase Realtime publication exists.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'comments'
     ) then
    execute 'alter publication supabase_realtime add table public.comments';
  end if;
end $$;
