-- LightJurnal Ludo online.
-- Run once in Supabase Dashboard -> SQL Editor after the existing LightJurnal schema.
-- Uses the existing public.profiles and auth.users tables. No service_role key belongs in the browser.

create extension if not exists pgcrypto;
create schema if not exists private;
grant usage on schema private to authenticated;

create table if not exists public.ludo_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-F0-9]{6}$'),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Mabar Ludo' check (char_length(title) between 2 and 50),
  status text not null default 'waiting' check (status in ('waiting','playing','finished','closed')),
  max_players integer not null default 4 check (max_players between 2 and 4),
  game_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.ludo_players (
  room_id uuid not null references public.ludo_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null default 'Pemain',
  seat integer not null check (seat between 0 and 3),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id),
  unique (room_id, seat)
);
create table if not exists public.ludo_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.ludo_rooms(id) on delete cascade,
  token text not null unique,
  created_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active','used','revoked')),
  used_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create table if not exists public.ludo_join_requests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.ludo_rooms(id) on delete cascade,
  room_code text not null default '',
  user_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null default 'Pemain',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, user_id)
);
alter table public.ludo_join_requests add column if not exists room_code text not null default '';
create index if not exists ludo_players_user_joined_idx on public.ludo_players(user_id, joined_at desc);
create index if not exists ludo_requests_room_status_idx on public.ludo_join_requests(room_id, status, created_at);
create index if not exists ludo_requests_user_status_idx on public.ludo_join_requests(user_id, status, updated_at desc);
create index if not exists ludo_invites_room_status_idx on public.ludo_invites(room_id, status, expires_at);

alter table public.ludo_rooms enable row level security;
alter table public.ludo_players enable row level security;
alter table public.ludo_invites enable row level security;
alter table public.ludo_join_requests enable row level security;

create or replace function private.is_ludo_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from public.ludo_players p where p.room_id=p_room_id and p.user_id=(select auth.uid()));
$$;
create or replace function private.is_ludo_owner(p_room_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from public.ludo_rooms r where r.id=p_room_id and r.owner_id=(select auth.uid()));
$$;
revoke all on function private.is_ludo_member(uuid) from public, anon, authenticated;
revoke all on function private.is_ludo_owner(uuid) from public, anon, authenticated;
grant execute on function private.is_ludo_member(uuid) to authenticated;
grant execute on function private.is_ludo_owner(uuid) to authenticated;

drop policy if exists "Ludo members read their rooms" on public.ludo_rooms;
create policy "Ludo members read their rooms" on public.ludo_rooms
for select to authenticated using (private.is_ludo_member(id));
drop policy if exists "Ludo members read their roster" on public.ludo_players;
create policy "Ludo members read their roster" on public.ludo_players
for select to authenticated using (private.is_ludo_member(room_id));
drop policy if exists "Requesters and room owners read join requests" on public.ludo_join_requests;
create policy "Requesters and room owners read join requests" on public.ludo_join_requests
for select to authenticated using (user_id=(select auth.uid()) or private.is_ludo_owner(room_id));

revoke all on table public.ludo_rooms, public.ludo_players, public.ludo_invites, public.ludo_join_requests from public, anon, authenticated;
grant select on public.ludo_rooms, public.ludo_players, public.ludo_join_requests to authenticated;
-- Writes are only through validated security-definer RPCs.

create or replace function public.ludo_create_room(p_title text default 'Mabar Ludo', p_max_players integer default 4)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid(); v_id uuid; v_code text; v_name text;
  v_title text := coalesce(nullif(btrim(p_title), ''), 'Mabar Ludo'); v_try integer;
begin
  if v_user is null then raise exception 'Masuk ke akun LightJurnal terlebih dahulu.'; end if;
  if p_max_players not between 2 and 4 then raise exception 'Jumlah pemain harus 2 sampai 4.'; end if;
  if char_length(v_title)>50 or char_length(v_title)<2 then raise exception 'Nama room harus 2–50 karakter.'; end if;
  select coalesce(nullif(btrim(p.display_name),''),nullif(split_part(coalesce(p.email,''),'@',1),''),'Pemain')
    into v_name from public.profiles p where p.id=v_user;
  if v_name is null then raise exception 'Profil akun belum siap. Muat ulang lalu coba lagi.'; end if;
  for v_try in 1..10 loop
    v_code:=upper(substr(upper(replace(gen_random_uuid()::text,'-','')),1,6));
    begin
      insert into public.ludo_rooms(code,owner_id,title,max_players) values(v_code,v_user,v_title,p_max_players) returning id into v_id;
      exit;
    exception when unique_violation then v_id:=null;
    end;
  end loop;
  if v_id is null then raise exception 'Gagal membuat kode room unik. Coba lagi.'; end if;
  insert into public.ludo_players(room_id,user_id,display_name,seat) values(v_id,v_user,v_name,0);
  return jsonb_build_object('room_id',v_id,'code',v_code,'title',v_title);
end;
$$;

create or replace function public.ludo_create_invite(p_room_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_token text:=substr(replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),1,48); v_room public.ludo_rooms%rowtype;
begin
  if auth.uid() is null then raise exception 'Masuk terlebih dahulu.'; end if;
  select * into v_room from public.ludo_rooms where id=p_room_id for update;
  if not found or v_room.owner_id<>auth.uid() then raise exception 'Hanya pemilik room yang boleh membuat undangan.'; end if;
  if v_room.status<>'waiting' then raise exception 'Undangan baru hanya bisa dibuat sebelum permainan dimulai.'; end if;
  if (select count(*) from public.ludo_players where room_id=p_room_id)>=v_room.max_players then raise exception 'Room sudah penuh.'; end if;
  insert into public.ludo_invites(room_id,token,created_by,expires_at) values(p_room_id,v_token,auth.uid(),now()+interval '24 hours');
  return v_token;
end;
$$;

create or replace function public.ludo_join_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid:=auth.uid(); v_invite public.ludo_invites%rowtype; v_room public.ludo_rooms%rowtype;
  v_invite_room_id uuid; v_name text; v_seat integer;
begin
  if v_user is null then raise exception 'Masuk ke akun LightJurnal terlebih dahulu.'; end if;
  if p_token is null or p_token !~ '^[a-f0-9]{48}$' then raise exception 'Tautan undangan tidak valid.'; end if;

  -- Lock in the same order as room close/start: room first, then invitation.
  select room_id into v_invite_room_id from public.ludo_invites where token=lower(p_token);
  if not found then raise exception 'Undangan tidak ditemukan atau sudah tidak berlaku.'; end if;
  select * into v_room from public.ludo_rooms where id=v_invite_room_id for update;
  if not found then raise exception 'Room tidak ditemukan.'; end if;
  select * into v_invite from public.ludo_invites where token=lower(p_token) for update;
  if not found then raise exception 'Undangan tidak ditemukan atau sudah tidak berlaku.'; end if;

  if v_invite.status='used' and v_invite.used_by=v_user
     and exists(select 1 from public.ludo_players p where p.room_id=v_invite.room_id and p.user_id=v_user) then
    return jsonb_build_object('room_id',v_room.id,'code',v_room.code,'status',v_room.status);
  end if;
  if v_invite.status<>'active' or v_invite.expires_at<=now() then
    raise exception 'Undangan sudah dipakai atau kedaluwarsa. Minta tautan baru kepada pemilik room.';
  end if;
  if v_room.status<>'waiting' then raise exception 'Room tidak lagi menerima pemain.'; end if;
  if exists(select 1 from public.ludo_players p where p.room_id=v_room.id and p.user_id=v_user) then
    update public.ludo_invites set status='used',used_by=v_user where id=v_invite.id;
    return jsonb_build_object('room_id',v_room.id,'code',v_room.code,'status',v_room.status);
  end if;
  if (select count(*) from public.ludo_players where room_id=v_room.id)>=v_room.max_players then
    raise exception 'Room sudah penuh.';
  end if;
  select coalesce(nullif(btrim(p.display_name),''),nullif(split_part(coalesce(p.email,''),'@',1),''),'Pemain')
    into v_name from public.profiles p where p.id=v_user;
  if v_name is null then raise exception 'Profil akun belum siap.'; end if;
  select slots.seat into v_seat from generate_series(0,3) as slots(seat)
    where not exists(select 1 from public.ludo_players p where p.room_id=v_room.id and p.seat=slots.seat)
    order by slots.seat limit 1;
  if v_seat is null then raise exception 'Tidak ada slot kosong di room ini.'; end if;
  insert into public.ludo_players(room_id,user_id,display_name,seat)
    values(v_room.id,v_user,v_name,v_seat);
  update public.ludo_invites set status='used',used_by=v_user where id=v_invite.id;
  return jsonb_build_object('room_id',v_room.id,'code',v_room.code,'status',v_room.status);
end;
$$;

create or replace function public.ludo_request_join(p_code text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid:=auth.uid(); v_room public.ludo_rooms%rowtype; v_name text; v_status text;
begin
  if v_user is null then raise exception 'Masuk terlebih dahulu.'; end if;
  if p_code is null or upper(btrim(p_code)) !~ '^[A-F0-9]{6}$' then raise exception 'Kode room harus 6 karakter.'; end if;
  select * into v_room from public.ludo_rooms where code=upper(btrim(p_code)) for update;
  if not found then raise exception 'Room tidak ditemukan. Periksa kode yang dibagikan pemiliknya.'; end if;
  if v_room.status<>'waiting' then raise exception 'Room sudah dimulai atau ditutup.'; end if;
  if exists(select 1 from public.ludo_players p where p.room_id=v_room.id and p.user_id=v_user) then
    return jsonb_build_object('status','member','room_id',v_room.id,'code',v_room.code);
  end if;
  if (select count(*) from public.ludo_players where room_id=v_room.id)>=v_room.max_players then raise exception 'Room sudah penuh.'; end if;
  select coalesce(nullif(btrim(p.display_name),''),nullif(split_part(coalesce(p.email,''),'@',1),''),'Pemain')
    into v_name from public.profiles p where p.id=v_user;
  insert into public.ludo_join_requests(room_id,room_code,user_id,display_name,status,updated_at)
  values(v_room.id,v_room.code,v_user,coalesce(v_name,'Pemain'),'pending',now())
  on conflict(room_id,user_id) do update
    set room_code=excluded.room_code,display_name=excluded.display_name,status='pending',updated_at=now()
    where public.ludo_join_requests.status<>'pending';
  select status into v_status from public.ludo_join_requests where room_id=v_room.id and user_id=v_user;
  return jsonb_build_object('status',v_status,'room_id',v_room.id,'code',v_room.code);
end;
$$;

create or replace function public.ludo_review_join_request(p_request_id uuid,p_approve boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_request public.ludo_join_requests%rowtype; v_room public.ludo_rooms%rowtype;
  v_room_id uuid; v_name text; v_seat integer;
begin
  if auth.uid() is null then raise exception 'Masuk terlebih dahulu.'; end if;

  -- Lock the room before the request so approval cannot deadlock with start/close.
  select room_id into v_room_id from public.ludo_join_requests where id=p_request_id;
  if not found then raise exception 'Permintaan tidak ditemukan.'; end if;
  select * into v_room from public.ludo_rooms where id=v_room_id for update;
  if not found or v_room.owner_id<>auth.uid() then
    raise exception 'Hanya pemilik room yang dapat meninjau permintaan.';
  end if;
  select * into v_request from public.ludo_join_requests where id=p_request_id for update;
  if not found then raise exception 'Permintaan tidak ditemukan.'; end if;
  if v_request.room_id<>v_room.id then raise exception 'Permintaan room tidak cocok.'; end if;
  if v_request.status<>'pending' then raise exception 'Permintaan ini sudah ditinjau.'; end if;

  if p_approve then
    if v_room.status<>'waiting' then raise exception 'Room sudah dimulai; permintaan tidak bisa disetujui.'; end if;
    if exists(select 1 from public.ludo_players p where p.room_id=v_room.id and p.user_id=v_request.user_id) then
      update public.ludo_join_requests set status='approved',updated_at=now() where id=v_request.id;
      return jsonb_build_object('status','approved','room_id',v_room.id);
    end if;
    if (select count(*) from public.ludo_players where room_id=v_room.id)>=v_room.max_players then
      raise exception 'Room sudah penuh. Permintaan belum disetujui.';
    end if;
    select slots.seat into v_seat from generate_series(0,3) as slots(seat)
      where not exists(select 1 from public.ludo_players p where p.room_id=v_room.id and p.seat=slots.seat)
      order by slots.seat limit 1;
    if v_seat is null then raise exception 'Tidak ada slot kosong di room ini.'; end if;
    select coalesce(nullif(btrim(p.display_name),''),nullif(split_part(coalesce(p.email,''),'@',1),''),v_request.display_name,'Pemain')
      into v_name from public.profiles p where p.id=v_request.user_id;
    insert into public.ludo_players(room_id,user_id,display_name,seat)
      values(v_room.id,v_request.user_id,coalesce(v_name,v_request.display_name,'Pemain'),v_seat);
    update public.ludo_join_requests set status='approved',updated_at=now() where id=v_request.id;
    return jsonb_build_object('status','approved','room_id',v_room.id,'seat',v_seat);
  else
    update public.ludo_join_requests set status='rejected',updated_at=now() where id=v_request.id;
    return jsonb_build_object('status','rejected','room_id',v_room.id);
  end if;
end;
$$;

create or replace function public.ludo_close_room(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_room public.ludo_rooms%rowtype;
begin
  if auth.uid() is null then raise exception 'Masuk terlebih dahulu.'; end if;
  select * into v_room from public.ludo_rooms where id=p_room_id for update;
  if not found or v_room.owner_id<>auth.uid() then raise exception 'Hanya pemilik room yang dapat menutup room.'; end if;
  if v_room.status not in ('waiting','finished') then raise exception 'Permainan yang sedang berlangsung tidak dapat ditutup dari sini.'; end if;
  update public.ludo_rooms set status='closed',updated_at=now() where id=p_room_id;
  update public.ludo_invites set status='revoked' where room_id=p_room_id and status='active';
  update public.ludo_join_requests set status='rejected',updated_at=now()
    where room_id=p_room_id and status='pending';
  return jsonb_build_object('status','closed');
end;
$$;

create or replace function public.ludo_leave_room(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_room public.ludo_rooms%rowtype; v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Masuk terlebih dahulu.'; end if;
  select * into v_room from public.ludo_rooms where id=p_room_id for update;
  if not found then raise exception 'Room tidak ditemukan.'; end if;
  if v_room.owner_id=v_user then raise exception 'Pemilik room harus menutup room, bukan keluar sendiri.'; end if;
  if v_room.status<>'waiting' then raise exception 'Permainan yang sudah dimulai tidak bisa ditinggalkan melalui tombol ini.'; end if;
  delete from public.ludo_join_requests where room_id=p_room_id and user_id=v_user;
  delete from public.ludo_players where room_id=p_room_id and user_id=v_user;
  return jsonb_build_object('status','left','room_id',p_room_id);
end;
$$;

create or replace function public.ludo_start_game(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.ludo_rooms%rowtype; v_players jsonb; v_tokens jsonb; v_first uuid; v_state jsonb; v_count integer;
begin
  if auth.uid() is null then raise exception 'Masuk terlebih dahulu.'; end if;
  select * into v_room from public.ludo_rooms where id=p_room_id for update;
  if not found or v_room.owner_id<>auth.uid() then raise exception 'Hanya pemilik room yang dapat memulai permainan.'; end if;
  if v_room.status<>'waiting' then raise exception 'Room tidak lagi menunggu permainan.'; end if;
  select count(*),
    jsonb_agg(jsonb_build_object('user_id',p.user_id,'seat',p.seat,'display_name',p.display_name) order by p.seat),
    jsonb_object_agg(p.user_id::text,'[-1,-1,-1,-1]'::jsonb order by p.seat),
    (array_agg(p.user_id order by p.seat))[1]
  into v_count,v_players,v_tokens,v_first from public.ludo_players p where p.room_id=p_room_id;
  if v_count<2 then raise exception 'Butuh minimal 2 pemain untuk memulai.'; end if;
  if v_count>v_room.max_players then raise exception 'Jumlah pemain melebihi kapasitas room.'; end if;
  v_state:=jsonb_build_object('version',1,'players',v_players,'tokens',v_tokens,'current_player_id',v_first,
    'pending_roll',null,'last_roll',null,'consecutive_sixes',0,'winner_id',null,'turn_number',1,
    'last_action','Permainan dimulai. Lempar dadu untuk bermain.');
  update public.ludo_invites set status='revoked' where room_id=p_room_id and status='active';
  update public.ludo_join_requests set status='rejected',updated_at=now()
    where room_id=p_room_id and status='pending';
  update public.ludo_rooms set status='playing',game_state=v_state,updated_at=now() where id=p_room_id;
  return v_state;
end;
$$;

create or replace function public.ludo_roll_dice(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.ludo_rooms%rowtype; v_state jsonb; v_user uuid:=auth.uid();
  v_current_seat integer; v_next_user uuid; v_dice integer; v_consecutive integer; v_name text;
begin
  if v_user is null then raise exception 'Masuk terlebih dahulu.'; end if;
  select * into v_room from public.ludo_rooms where id=p_room_id for update;
  if not found or v_room.status<>'playing' then raise exception 'Permainan tidak sedang berlangsung.'; end if;
  v_state:=v_room.game_state;
  if v_state->>'current_player_id'<>v_user::text then raise exception 'Belum giliranmu.'; end if;
  if v_state->'pending_roll' is not null and v_state->'pending_roll'<>'null'::jsonb then raise exception 'Jalankan pion yang tersedia sebelum melempar lagi.'; end if;
  select p.seat,p.display_name into v_current_seat,v_name from public.ludo_players p where p.room_id=p_room_id and p.user_id=v_user;
  if v_current_seat is null then raise exception 'Kamu bukan pemain room ini.'; end if;
  v_dice:=floor(random()*6)::integer+1;
  v_consecutive:=coalesce((v_state->>'consecutive_sixes')::integer,0);
  v_state:=jsonb_set(v_state,'{last_roll}',to_jsonb(v_dice),true);
  if v_dice=6 and v_consecutive>=2 then
    select p.user_id into v_next_user from public.ludo_players p where p.room_id=p_room_id and p.seat>v_current_seat order by p.seat limit 1;
    if v_next_user is null then select p.user_id into v_next_user from public.ludo_players p where p.room_id=p_room_id order by p.seat limit 1; end if;
    v_state:=jsonb_set(v_state,'{pending_roll}','null'::jsonb,true);
    v_state:=jsonb_set(v_state,'{consecutive_sixes}','0'::jsonb,true);
    v_state:=jsonb_set(v_state,'{current_player_id}',to_jsonb(v_next_user),true);
    v_state:=jsonb_set(v_state,'{last_action}',to_jsonb(v_name||' mendapat enam untuk ketiga kalinya. Giliran berpindah.'),true);
    v_state:=jsonb_set(v_state,'{turn_number}',to_jsonb(coalesce((v_state->>'turn_number')::integer,1)+1),true);
  else
    v_state:=jsonb_set(v_state,'{pending_roll}',to_jsonb(v_dice),true);
    v_state:=jsonb_set(v_state,'{consecutive_sixes}',to_jsonb(case when v_dice=6 then v_consecutive+1 else 0 end),true);
    v_state:=jsonb_set(v_state,'{last_action}',to_jsonb(v_name||' mendapat angka '||v_dice||'.'),true);
  end if;
  update public.ludo_rooms set game_state=v_state,updated_at=now() where id=p_room_id;
  return v_state;
end;
$$;

create or replace function public.ludo_move_token(p_room_id uuid,p_token_index integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.ludo_rooms%rowtype; v_state jsonb; v_user uuid:=auth.uid(); v_seat integer; v_name text;
  v_roll integer; v_progress integer; v_new_progress integer; v_current_pos integer;
  v_opponent record; v_op_idx integer; v_op_progress integer; v_op_pos integer;
  v_capture_count integer:=0; v_offsets integer[]:=array[0,13,26,39]; v_safe_cells integer[]:=array[0,8,13,21,26,34,39,47];
  v_finished_count integer; v_next_user uuid; v_next_name text; v_message text;
begin
  if v_user is null then raise exception 'Masuk terlebih dahulu.'; end if;
  if p_token_index is null or p_token_index<0 or p_token_index>3 then raise exception 'Pion tidak valid.'; end if;
  select * into v_room from public.ludo_rooms where id=p_room_id for update;
  if not found or v_room.status<>'playing' then raise exception 'Permainan tidak sedang berlangsung.'; end if;
  v_state:=v_room.game_state;
  if v_state->>'current_player_id'<>v_user::text then raise exception 'Belum giliranmu.'; end if;
  if v_state->'pending_roll' is null or v_state->'pending_roll'='null'::jsonb then raise exception 'Lempar dadu terlebih dahulu.'; end if;
  v_roll:=(v_state->>'pending_roll')::integer;
  select p.seat,p.display_name into v_seat,v_name from public.ludo_players p where p.room_id=p_room_id and p.user_id=v_user;
  if v_seat is null then raise exception 'Kamu bukan pemain room ini.'; end if;
  v_progress:=(v_state #>> array['tokens',v_user::text,p_token_index::text])::integer;
  if v_progress is null then raise exception 'Status pion tidak ditemukan. Muat ulang room.'; end if;
  if v_progress=-1 then
    if v_roll<>6 then raise exception 'Pion dari rumah hanya bisa keluar saat mendapat angka enam.'; end if;
    v_new_progress:=0;
  else
    v_new_progress:=v_progress+v_roll;
    if v_progress=57 or v_new_progress>57 then raise exception 'Pion harus mendapat angka yang pas untuk mencapai rumah akhir.'; end if;
  end if;
  v_state:=jsonb_set(v_state,array['tokens',v_user::text,p_token_index::text],to_jsonb(v_new_progress),true);
  if v_new_progress<=51 then
    v_current_pos:=(v_offsets[v_seat+1]+v_new_progress)%52;
    if not (v_current_pos=any(v_safe_cells)) then
      for v_opponent in select p.user_id,p.seat,p.display_name from public.ludo_players p where p.room_id=p_room_id and p.user_id<>v_user loop
        for v_op_idx in 0..3 loop
          v_op_progress:=(v_state #>> array['tokens',v_opponent.user_id::text,v_op_idx::text])::integer;
          if v_op_progress>=0 and v_op_progress<=51 then
            v_op_pos:=(v_offsets[v_opponent.seat+1]+v_op_progress)%52;
            if v_op_pos=v_current_pos then
              v_state:=jsonb_set(v_state,array['tokens',v_opponent.user_id::text,v_op_idx::text],to_jsonb(-1),true);
              v_capture_count:=v_capture_count+1;
            end if;
          end if;
        end loop;
      end loop;
    end if;
  end if;
  select count(*) into v_finished_count from generate_series(0,3) as piece(idx)
    where (v_state #>> array['tokens',v_user::text,piece.idx::text])::integer=57;
  if v_finished_count=4 then
    v_state:=jsonb_set(v_state,'{winner_id}',to_jsonb(v_user),true);
    v_state:=jsonb_set(v_state,'{pending_roll}','null'::jsonb,true);
    v_state:=jsonb_set(v_state,'{last_action}',to_jsonb(v_name||' memenangkan permainan!'),true);
    update public.ludo_rooms set status='finished',game_state=v_state,updated_at=now() where id=p_room_id;
    return v_state;
  end if;
  if v_capture_count>0 then v_message:=v_name||' memakan '||v_capture_count||' pion lawan.';
  else v_message:=v_name||' memindahkan pion.';
  end if;
  v_state:=jsonb_set(v_state,'{pending_roll}','null'::jsonb,true);
  if v_roll=6 then
    v_state:=jsonb_set(v_state,'{last_action}',to_jsonb(v_message||' Mendapat enam, jadi mendapat giliran lagi.'),true);
  else
    select p.user_id,p.display_name into v_next_user,v_next_name from public.ludo_players p where p.room_id=p_room_id and p.seat>v_seat order by p.seat limit 1;
    if v_next_user is null then select p.user_id,p.display_name into v_next_user,v_next_name from public.ludo_players p where p.room_id=p_room_id order by p.seat limit 1; end if;
    v_state:=jsonb_set(v_state,'{current_player_id}',to_jsonb(v_next_user),true);
    v_state:=jsonb_set(v_state,'{consecutive_sixes}','0'::jsonb,true);
    v_state:=jsonb_set(v_state,'{turn_number}',to_jsonb(coalesce((v_state->>'turn_number')::integer,1)+1),true);
    v_state:=jsonb_set(v_state,'{last_action}',to_jsonb(v_message||' Giliran '||coalesce(v_next_name,'pemain berikutnya')||'.'),true);
  end if;
  update public.ludo_rooms set game_state=v_state,updated_at=now() where id=p_room_id;
  return v_state;
end;
$$;

create or replace function public.ludo_skip_turn(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.ludo_rooms%rowtype; v_state jsonb; v_user uuid:=auth.uid(); v_seat integer;
  v_roll integer; v_idx integer; v_progress integer; v_has_move boolean:=false;
  v_next_user uuid; v_next_name text; v_name text;
begin
  if v_user is null then raise exception 'Masuk terlebih dahulu.'; end if;
  select * into v_room from public.ludo_rooms where id=p_room_id for update;
  if not found or v_room.status<>'playing' then raise exception 'Permainan tidak sedang berlangsung.'; end if;
  v_state:=v_room.game_state;
  if v_state->>'current_player_id'<>v_user::text then raise exception 'Belum giliranmu.'; end if;
  if v_state->'pending_roll' is null or v_state->'pending_roll'='null'::jsonb then raise exception 'Belum ada hasil dadu untuk dilewati.'; end if;
  v_roll:=(v_state->>'pending_roll')::integer;
  select p.seat,p.display_name into v_seat,v_name from public.ludo_players p where p.room_id=p_room_id and p.user_id=v_user;
  for v_idx in 0..3 loop
    v_progress:=(v_state #>> array['tokens',v_user::text,v_idx::text])::integer;
    if (v_progress=-1 and v_roll=6) or (v_progress>=0 and v_progress<57 and v_progress+v_roll<=57) then v_has_move:=true; end if;
  end loop;
  if v_has_move then raise exception 'Masih ada pion yang dapat dijalankan.'; end if;
  select p.user_id,p.display_name into v_next_user,v_next_name from public.ludo_players p where p.room_id=p_room_id and p.seat>v_seat order by p.seat limit 1;
  if v_next_user is null then select p.user_id,p.display_name into v_next_user,v_next_name from public.ludo_players p where p.room_id=p_room_id order by p.seat limit 1; end if;
  v_state:=jsonb_set(v_state,'{pending_roll}','null'::jsonb,true);
  v_state:=jsonb_set(v_state,'{current_player_id}',to_jsonb(v_next_user),true);
  v_state:=jsonb_set(v_state,'{consecutive_sixes}','0'::jsonb,true);
  v_state:=jsonb_set(v_state,'{turn_number}',to_jsonb(coalesce((v_state->>'turn_number')::integer,1)+1),true);
  v_state:=jsonb_set(v_state,'{last_action}',to_jsonb(v_name||' tidak punya langkah yang valid. Giliran '||coalesce(v_next_name,'pemain berikutnya')||'.'),true);
  update public.ludo_rooms set game_state=v_state,updated_at=now() where id=p_room_id;
  return v_state;
end;
$$;

revoke all on function public.ludo_create_room(text,integer) from public,anon;
revoke all on function public.ludo_create_invite(uuid) from public,anon;
revoke all on function public.ludo_join_invite(text) from public,anon;
revoke all on function public.ludo_request_join(text) from public,anon;
revoke all on function public.ludo_review_join_request(uuid,boolean) from public,anon;
revoke all on function public.ludo_close_room(uuid) from public,anon;
revoke all on function public.ludo_leave_room(uuid) from public,anon;
revoke all on function public.ludo_start_game(uuid) from public,anon;
revoke all on function public.ludo_roll_dice(uuid) from public,anon;
revoke all on function public.ludo_move_token(uuid,integer) from public,anon;
revoke all on function public.ludo_skip_turn(uuid) from public,anon;
grant execute on function public.ludo_create_room(text,integer) to authenticated;
grant execute on function public.ludo_create_invite(uuid) to authenticated;
grant execute on function public.ludo_join_invite(text) to authenticated;
grant execute on function public.ludo_request_join(text) to authenticated;
grant execute on function public.ludo_review_join_request(uuid,boolean) to authenticated;
grant execute on function public.ludo_close_room(uuid) to authenticated;
grant execute on function public.ludo_leave_room(uuid) to authenticated;
grant execute on function public.ludo_start_game(uuid) to authenticated;
grant execute on function public.ludo_roll_dice(uuid) to authenticated;
grant execute on function public.ludo_move_token(uuid,integer) to authenticated;
grant execute on function public.ludo_skip_turn(uuid) to authenticated;

alter table public.ludo_rooms replica identity full;
alter table public.ludo_players replica identity full;
alter table public.ludo_join_requests replica identity full;
do $$
declare v_table text;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['ludo_rooms','ludo_players','ludo_join_requests'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then
        execute format('alter publication supabase_realtime add table public.%I',v_table);
      end if;
    end loop;
  end if;
end $$;

-- Refresh PostgREST's schema cache so the RPC functions are available immediately.
notify pgrst, 'reload schema';
