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

-- Geteilte Boards: wer darf mitarbeiten
create table if not exists public.board_members (
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (board_id, user_id)
);

-- Darf der aktuelle Nutzer auf dieses Board? (Besitzer ODER Mitglied)
create or replace function public.is_board_member(b uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.boards        where id = b        and owner   = auth.uid())
      or exists (select 1 from public.board_members where board_id = b and user_id = auth.uid());
$$;

alter table public.boards         enable row level security;
alter table public.board_members  enable row level security;

-- Boards: lesen/ändern, wenn Besitzer oder Mitglied; anlegen/löschen nur Besitzer
drop policy if exists boards_select on public.boards;
create policy boards_select on public.boards for select using (public.is_board_member(id));
drop policy if exists boards_insert on public.boards;
create policy boards_insert on public.boards for insert with check (owner = auth.uid());
drop policy if exists boards_update on public.boards;
create policy boards_update on public.boards for update using (public.is_board_member(id));
drop policy if exists boards_delete on public.boards;
create policy boards_delete on public.boards for delete using (owner = auth.uid());

-- Mitglieder: Besitzer verwaltet; Mitglieder dürfen die Liste ihres Boards sehen
drop policy if exists members_select on public.board_members;
create policy members_select on public.board_members for select using (public.is_board_member(board_id));
drop policy if exists members_manage on public.board_members;
create policy members_manage on public.board_members for all
  using      (exists (select 1 from public.boards where id = board_id and owner = auth.uid()))
  with check (exists (select 1 from public.boards where id = board_id and owner = auth.uid()));

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

-- Board per Team-Code beitreten (fügt den aktuellen Nutzer als Mitglied hinzu)
create or replace function public.join_board(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid;
begin
  select id into bid from public.boards where share_code = code;
  if bid is null then raise exception 'Ungueltiger Code'; end if;
  insert into public.board_members (board_id, user_id) values (bid, auth.uid())
    on conflict do nothing;
  return bid;
end; $$;

-- Geteiltes Board verlassen (entfernt nur die eigene Mitgliedschaft, löscht keine Daten)
create or replace function public.leave_board(b uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.board_members where board_id = b and user_id = auth.uid();
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
drop policy if exists att_select on storage.objects;
create policy att_select on storage.objects for select
  using (bucket_id = 'attachments' and public.is_board_member(((storage.foldername(name))[1])::uuid));
drop policy if exists att_insert on storage.objects;
create policy att_insert on storage.objects for insert
  with check (bucket_id = 'attachments' and public.is_board_member(((storage.foldername(name))[1])::uuid));
drop policy if exists att_delete on storage.objects;
create policy att_delete on storage.objects for delete
  using (bucket_id = 'attachments' and public.is_board_member(((storage.foldername(name))[1])::uuid));
