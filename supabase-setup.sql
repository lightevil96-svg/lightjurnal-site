-- LightJurnal: Supabase schema, access rules, and private PDF storage.
-- Run this in Supabase Dashboard -> SQL Editor.
-- Set the first admin separately using the instructions in SUPABASE-SETUP.md.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default '',
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.journals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 200),
  author_name text not null check (char_length(author_name) between 2 and 120),
  category text not null check (category in ('Pendidikan', 'Teknologi', 'Sosial', 'Kesehatan', 'Lainnya')),
  description text not null check (char_length(description) between 10 and 2000),
  tags text[] not null default '{}',
  type text not null default 'Jurnal',
  file_path text not null unique,
  original_filename text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists journals_status_created_at_idx
  on public.journals (status, created_at desc);
create index if not exists journals_user_created_at_idx
  on public.journals (user_id, created_at desc);

-- SECURITY DEFINER avoids recursive RLS checks when policies ask whether the
-- currently authenticated account is an administrator.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- New sign-ups always receive the 'user' role. Never trust role from user metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    'user'
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_lightjurnal on auth.users;
create trigger on_auth_user_created_lightjurnal
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.journals enable row level security;

grant select on public.profiles to authenticated;
grant select on public.journals to anon, authenticated;
grant insert, update, delete on public.journals to authenticated;

drop policy if exists "Read own profile or admin profiles" on public.profiles;
create policy "Read own profile or admin profiles"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "Public read approved or owner or admin" on public.journals;
create policy "Public read approved or owner or admin"
on public.journals for select
to anon, authenticated
using (status = 'approved' or user_id = auth.uid() or public.is_admin());

drop policy if exists "Authenticated users submit their own pending journals" on public.journals;
create policy "Authenticated users submit their own pending journals"
on public.journals for insert
to authenticated
with check (
  user_id = auth.uid()
  and status = 'pending'
  and admin_note is null
  and reviewed_at is null
  and split_part(file_path, '/', 1) = auth.uid()::text
);

drop policy if exists "Only admins update journal records" on public.journals;
create policy "Only admins update journal records"
on public.journals for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Only admins delete journal records" on public.journals;
create policy "Only admins delete journal records"
on public.journals for delete
to authenticated
using (public.is_admin());

-- Every submitted PDF stays private until a moderator approves the journal.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('journal-pdfs', 'journal-pdfs', false, 25000000, array['application/pdf']::text[])
on conflict (id) do update
set public = false,
    file_size_limit = 25000000,
    allowed_mime_types = array['application/pdf']::text[];

drop policy if exists "Read approved or owned journal PDFs" on storage.objects;
create policy "Read approved or owned journal PDFs"
on storage.objects for select
to anon, authenticated
using (
  bucket_id = 'journal-pdfs'
  and (
    public.is_admin()
    or exists (
      select 1 from public.journals j
      where j.file_path = name and j.status = 'approved'
    )
    or exists (
      select 1 from public.journals j
      where j.file_path = name and j.user_id = auth.uid()
    )
  )
);

drop policy if exists "Upload PDF to personal folder" on storage.objects;
create policy "Upload PDF to personal folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'journal-pdfs'
  and (storage.foldername(name))[1] = auth.uid()::text
  and lower(storage.filename(name)) like '%.pdf'
);

drop policy if exists "Remove own unlinked files or admin files" on storage.objects;
create policy "Remove own unlinked files or admin files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'journal-pdfs'
  and (
    public.is_admin()
    or (
      (storage.foldername(name))[1] = auth.uid()::text
      and not exists (select 1 from public.journals j where j.file_path = name)
    )
  )
);

-- After signing up with your intended admin account, run the one-time promotion
-- statement from SUPABASE-SETUP.md. Do not enable public profile writes.
