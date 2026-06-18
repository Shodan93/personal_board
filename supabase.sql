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

-- Geteilte Boards: wer hat (nur lesenden) Zugriff
create table if not exists public.board_members (
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (board_id, user_id)
);
-- E-Mail (damit der Besitzer sieht, WER Zugriff hat) + Rolle + Beitrittszeit
alter table public.board_members add column if not exists email text;
alter table public.board_members add column if not exists role text not null default 'viewer';
alter table public.board_members add column if not exists added_at timestamptz not null default now();

-- Darf der aktuelle Nutzer auf dieses Board? (Besitzer ODER Mitglied)
create or replace function public.is_board_member(b uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.boards        where id = b        and owner   = auth.uid())
      or exists (select 1 from public.board_members where board_id = b and user_id = auth.uid());
$$;

alter table public.boards         enable row level security;
alter table public.board_members  enable row level security;

-- Boards: LESEN Besitzer ODER Mitglied; SCHREIBEN/anlegen/löschen NUR Besitzer
-- (Mitglieder = reiner Lesezugriff -> kein update)
drop policy if exists boards_select on public.boards;
create policy boards_select on public.boards for select using (public.is_board_member(id));
drop policy if exists boards_insert on public.boards;
create policy boards_insert on public.boards for insert with check (owner = auth.uid());
drop policy if exists boards_update on public.boards;
create policy boards_update on public.boards for update using (owner = auth.uid()) with check (owner = auth.uid());
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
  return b;
end; $$;

-- Board per Teilen-Code beitreten (Lesezugriff). Speichert die E-Mail des Beitretenden,
-- damit der Besitzer sieht, wer Zugriff hat. Eigenes Board kann man nicht "beitreten".
create or replace function public.join_board(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid; uemail text;
begin
  select id into bid from public.boards where share_code = code;
  if bid is null then raise exception 'Ungueltiger Code'; end if;
  if exists (select 1 from public.boards where id = bid and owner = auth.uid()) then
    raise exception 'Das ist dein eigenes Board'; end if;
  uemail := coalesce(auth.jwt() ->> 'email', '');
  insert into public.board_members (board_id, user_id, email, role)
    values (bid, auth.uid(), uemail, 'viewer')
    on conflict (board_id, user_id) do update set email = excluded.email;
  return bid;
end; $$;

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

-- Teilen-Code neu generieren (nur Besitzer) — alte Codes funktionieren danach nicht mehr
create or replace function public.rotate_share_code(b uuid)
returns text language plpgsql security definer set search_path = public as $$
declare newcode text;
begin
  if not exists (select 1 from public.boards where id = b and owner = auth.uid()) then
    raise exception 'Nicht berechtigt'; end if;
  newcode := encode(gen_random_bytes(5), 'hex');
  update public.boards set share_code = newcode where id = b;
  return newcode;
end; $$;

-- Zugriff einer Person entfernen + Code rotieren (nur Besitzer), gibt den neuen Code zurück
create or replace function public.remove_member(b uuid, uid uuid)
returns text language plpgsql security definer set search_path = public as $$
declare newcode text;
begin
  if not exists (select 1 from public.boards where id = b and owner = auth.uid()) then
    raise exception 'Nicht berechtigt'; end if;
  delete from public.board_members where board_id = b and user_id = uid;
  newcode := encode(gen_random_bytes(5), 'hex');
  update public.boards set share_code = newcode where id = b;
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
-- Mitglieder dürfen Anhänge ANSEHEN; HOCHLADEN/LÖSCHEN nur der Besitzer.
drop policy if exists att_select on storage.objects;
create policy att_select on storage.objects for select
  using (bucket_id = 'attachments' and public.is_board_member(((storage.foldername(name))[1])::uuid));
drop policy if exists att_insert on storage.objects;
create policy att_insert on storage.objects for insert
  with check (bucket_id = 'attachments' and exists (select 1 from public.boards b where b.id = ((storage.foldername(name))[1])::uuid and b.owner = auth.uid()));
drop policy if exists att_delete on storage.objects;
create policy att_delete on storage.objects for delete
  using (bucket_id = 'attachments' and exists (select 1 from public.boards b where b.id = ((storage.foldername(name))[1])::uuid and b.owner = auth.uid()));
