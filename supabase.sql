-- ============================================================
-- ORBIT — Supabase-Schema
-- In Supabase: SQL Editor -> New query -> alles einfügen -> RUN
-- ============================================================

-- Ein Board = eine JSONB-Zeile (tickets, categories, settings, notes)
create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'Mein Board',
  data jsonb not null default '{}'::jsonb,
  share_code text unique default encode(gen_random_bytes(5), 'hex'),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Geteilte Boards: Mitglieder mit Rolle 'viewer' (nur lesen) oder 'editor' (lesen + schreiben)
create table if not exists public.board_members (
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (board_id, user_id)
);
-- E-Mail (damit der Besitzer sieht, WER Zugriff hat) + Rolle + Beitrittszeit
alter table public.board_members add column if not exists email text;
alter table public.board_members add column if not exists role text not null default 'viewer';
alter table public.board_members add column if not exists added_at timestamptz not null default now();
alter table public.board_members drop constraint if exists board_members_role_check;
alter table public.board_members add constraint board_members_role_check check (role in ('viewer','editor'));

-- Teilen-Codes liegen in einer EIGENEN Tabelle mit Owner-only-RLS.
-- (Lägen sie in boards, könnte jedes Mitglied den edit_code lesen und sich
--  selbst zum Editor machen — deshalb strikt getrennt.)
create table if not exists public.board_codes (
  board_id   uuid primary key references public.boards(id) on delete cascade,
  share_code text unique not null default encode(gen_random_bytes(5), 'hex'),
  edit_code  text unique not null default encode(gen_random_bytes(5), 'hex')
);
alter table public.board_codes enable row level security;
drop policy if exists codes_owner_select on public.board_codes;
create policy codes_owner_select on public.board_codes for select using (
  exists (select 1 from public.boards b where b.id = board_id and b.owner = auth.uid()));
-- Schreiben nur über SECURITY-DEFINER-RPCs (keine insert/update/delete-Policies).

-- Bestehende share_codes aus boards übernehmen; für jedes Board eine Codes-Zeile
insert into public.board_codes (board_id, share_code)
  select id, coalesce(share_code, encode(gen_random_bytes(5), 'hex')) from public.boards
  on conflict (board_id) do nothing;

-- Darf der aktuelle Nutzer dieses Board SEHEN? (Besitzer ODER Mitglied)
create or replace function public.is_board_member(b uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.boards        where id = b        and owner   = auth.uid())
      or exists (select 1 from public.board_members where board_id = b and user_id = auth.uid());
$$;

-- Darf der aktuelle Nutzer dieses Board BEARBEITEN? (Besitzer ODER Editor-Mitglied)
create or replace function public.can_edit_board(b uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.boards        where id = b and owner = auth.uid())
      or exists (select 1 from public.board_members where board_id = b and user_id = auth.uid() and role = 'editor');
$$;

alter table public.boards         enable row level security;
alter table public.board_members  enable row level security;

-- Boards: LESEN Besitzer/Mitglied; ÄNDERN Besitzer/Editor; anlegen/löschen NUR Besitzer
drop policy if exists boards_select on public.boards;
create policy boards_select on public.boards for select using (public.is_board_member(id));
drop policy if exists boards_insert on public.boards;
create policy boards_insert on public.boards for insert with check (owner = auth.uid());
drop policy if exists boards_update on public.boards;
create policy boards_update on public.boards for update using (public.can_edit_board(id)) with check (public.can_edit_board(id));
drop policy if exists boards_delete on public.boards;
create policy boards_delete on public.boards for delete using (owner = auth.uid());

-- Mitglieder: Besitzer sieht alle Mitglieder seines Boards; jeder sieht die eigene Zeile.
-- Verwaltung (insert/delete) läuft über SECURITY-DEFINER-RPCs (join_board/remove_member).
drop policy if exists members_select on public.board_members;
create policy members_select on public.board_members for select using (
  user_id = auth.uid()
  or exists (select 1 from public.boards b where b.id = board_id and b.owner = auth.uid())
);
drop policy if exists members_manage on public.board_members;

-- Board anlegen (umgeht die Insert-Policy zuverlässig; Besitzer = aktueller Nutzer)
create or replace function public.create_board(p_title text, p_data jsonb)
returns public.boards language plpgsql security definer set search_path = public as $$
declare b public.boards;
begin
  insert into public.boards (owner, title, data)
  values (auth.uid(), coalesce(nullif(p_title, ''), 'Mein Board'), coalesce(p_data, '{}'::jsonb))
  returning * into b;
  insert into public.board_codes (board_id) values (b.id) on conflict (board_id) do nothing;
  return b;
end; $$;

-- Board per Teilen-Code beitreten. share_code -> Rolle 'viewer', edit_code -> 'editor'.
-- Beitritt mit edit_code stuft ein bestehendes viewer-Mitglied hoch; ein viewer-Code
-- stuft einen Editor NIE herab. Eigenes Board kann man nicht "beitreten".
create or replace function public.join_board(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid; r text; uemail text;
begin
  select board_id, 'viewer' into bid, r from public.board_codes where share_code = code;
  if bid is null then
    select board_id, 'editor' into bid, r from public.board_codes where edit_code = code;
  end if;
  if bid is null then raise exception 'Ungueltiger Code'; end if;
  if exists (select 1 from public.boards where id = bid and owner = auth.uid()) then
    raise exception 'Das ist dein eigenes Board'; end if;
  uemail := coalesce(auth.jwt() ->> 'email', '');
  insert into public.board_members (board_id, user_id, email, role)
    values (bid, auth.uid(), uemail, r)
    on conflict (board_id, user_id) do update
      set email = excluded.email,
          role  = case when excluded.role = 'editor' then 'editor' else public.board_members.role end;
  return bid;
end; $$;

-- Rolle eines Mitglieds ändern (nur Besitzer): 'viewer' oder 'editor'
create or replace function public.set_member_role(b uuid, uid uuid, r text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if r not in ('viewer','editor') then raise exception 'Ungueltige Rolle'; end if;
  if not exists (select 1 from public.boards where id = b and owner = auth.uid()) then
    raise exception 'Nicht berechtigt'; end if;
  update public.board_members set role = r where board_id = b and user_id = uid;
end; $$;

-- Eigene Rolle auf einem Board abfragen ('owner' | 'editor' | 'viewer' | null)
create or replace function public.my_board_role(b uuid)
returns text language sql security definer set search_path = public as $$
  select case
    when exists (select 1 from public.boards where id = b and owner = auth.uid()) then 'owner'
    else (select role from public.board_members where board_id = b and user_id = auth.uid())
  end;
$$;

-- Geteiltes Board verlassen (entfernt nur die eigene Mitgliedschaft, löscht keine Daten)
create or replace function public.leave_board(b uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.board_members where board_id = b and user_id = auth.uid();
end; $$;

-- Mitglieder eines Boards auflisten (nur der Besitzer) — inkl. E-Mail
create or replace function public.board_members_list(b uuid)
returns table(user_id uuid, email text, role text, added_at timestamptz)
language sql security definer set search_path = public as $$
  select m.user_id, m.email, m.role, m.added_at
  from public.board_members m
  where m.board_id = b
    and exists (select 1 from public.boards bo where bo.id = b and bo.owner = auth.uid());
$$;

-- Teilen-Code neu generieren (nur Besitzer). kind: 'share' (Lesen) oder 'edit' (Bearbeiten).
-- Alte Codes der Art funktionieren danach nicht mehr.
create or replace function public.rotate_code(b uuid, kind text)
returns text language plpgsql security definer set search_path = public as $$
declare newcode text;
begin
  if kind not in ('share','edit') then raise exception 'Ungueltige Art'; end if;
  if not exists (select 1 from public.boards where id = b and owner = auth.uid()) then
    raise exception 'Nicht berechtigt'; end if;
  newcode := encode(gen_random_bytes(5), 'hex');
  insert into public.board_codes (board_id) values (b) on conflict (board_id) do nothing;
  if kind = 'share' then update public.board_codes set share_code = newcode where board_id = b;
  else                   update public.board_codes set edit_code  = newcode where board_id = b;
  end if;
  return newcode;
end; $$;

-- Kompatibilität: alte Funktion rotiert den Lese-Code
create or replace function public.rotate_share_code(b uuid)
returns text language sql security definer set search_path = public as $$
  select public.rotate_code(b, 'share');
$$;

-- Zugriff einer Person entfernen + BEIDE Codes rotieren (nur Besitzer)
create or replace function public.remove_member(b uuid, uid uuid)
returns text language plpgsql security definer set search_path = public as $$
declare newcode text;
begin
  if not exists (select 1 from public.boards where id = b and owner = auth.uid()) then
    raise exception 'Nicht berechtigt'; end if;
  delete from public.board_members where board_id = b and user_id = uid;
  perform public.rotate_code(b, 'edit');
  newcode := public.rotate_code(b, 'share');
  return newcode;
end; $$;

-- Realtime für Boards einschalten (Live-Sync) — idempotent, ignoriert "schon vorhanden"
do $$
begin
  alter publication supabase_realtime add table public.boards;
exception when duplicate_object then null;
end $$;

-- ============================================================
-- STORAGE — Bucket "attachments" für Anhänge (Pfad: <board_id>/<file_id>)
-- Den Bucket NICHT public machen; Zugriff regeln die Policies unten.
-- Falls der Bucket noch nicht existiert, lege ihn vorher unter
-- Storage -> New bucket -> Name "attachments" (Private) an.
-- ============================================================
-- Mitglieder dürfen Anhänge ANSEHEN; HOCHLADEN/LÖSCHEN Besitzer UND Editoren.
drop policy if exists att_select on storage.objects;
create policy att_select on storage.objects for select
  using (bucket_id = 'attachments' and public.is_board_member(((storage.foldername(name))[1])::uuid));
drop policy if exists att_insert on storage.objects;
create policy att_insert on storage.objects for insert
  with check (bucket_id = 'attachments' and public.can_edit_board(((storage.foldername(name))[1])::uuid));
drop policy if exists att_delete on storage.objects;
create policy att_delete on storage.objects for delete
  using (bucket_id = 'attachments' and public.can_edit_board(((storage.foldername(name))[1])::uuid));
