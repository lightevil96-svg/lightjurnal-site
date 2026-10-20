-- LightJurnal Ludo: permanently close an online room when a member leaves.
-- Run once in Supabase SQL Editor if the initial Ludo migration has already been applied.
-- For a new installation, supabase-ludo-migration.sql already includes these definitions.
create or replace function public.ludo_join_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid:=auth.uid(); v_invite public.ludo_invites%rowtype; v_room public.ludo_rooms%rowtype;
  v_invite_room_id uuid; v_name text; v_seat integer;
begin
  if v_user is null then raise exception 'Masuk ke akun LightJurnal terlebih dahulu.'; end if;
  if p_token is null or p_token !~ '^[a-f0-9]{48}$' then raise exception 'Tautan undangan tidak valid.'; end if;
  select room_id into v_invite_room_id from public.ludo_invites where token=lower(p_token);
  if not found then raise exception 'Undangan tidak ditemukan atau sudah tidak berlaku.'; end if;
  select * into v_room from public.ludo_rooms where id=v_invite_room_id for update;
  if not found then raise exception 'Room tidak ditemukan.'; end if;
  select * into v_invite from public.ludo_invites where token=lower(p_token) for update;
  if not found then raise exception 'Undangan tidak ditemukan atau sudah tidak berlaku.'; end if;
  if v_room.status='closed' then
    raise exception 'Room ini sudah ditutup. Buat room baru untuk bermain lagi.';
  end if;
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

create or replace function public.ludo_close_room(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_room public.ludo_rooms%rowtype;
begin
  if auth.uid() is null then raise exception 'Masuk terlebih dahulu.'; end if;
  select * into v_room from public.ludo_rooms where id=p_room_id for update;
  if not found or v_room.owner_id<>auth.uid() then raise exception 'Hanya pemilik room yang dapat menutup room.'; end if;
  if v_room.status='closed' then return jsonb_build_object('status','closed'); end if;
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
  if not exists(select 1 from public.ludo_players p where p.room_id=p_room_id and p.user_id=v_user) then
    raise exception 'Kamu bukan anggota room ini.';
  end if;
  if v_room.status='closed' then return jsonb_build_object('status','closed','room_id',p_room_id); end if;
  -- Leaving the room closes it for every player; stale codes and links cannot revive it.
  update public.ludo_rooms set status='closed',updated_at=now() where id=p_room_id;
  update public.ludo_invites set status='revoked' where room_id=p_room_id and status='active';
  update public.ludo_join_requests set status='rejected',updated_at=now()
    where room_id=p_room_id and status='pending';
  return jsonb_build_object('status','closed','room_id',p_room_id);
end;
$$;

notify pgrst, 'reload schema';
