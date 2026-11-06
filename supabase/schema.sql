-- Cardápio 3D · estrutura na nuvem (Supabase)
-- Como usar: Supabase > SQL Editor > cole este arquivo > Run.
-- Depois: Authentication > Users > "Add user" para criar o login do dono (e-mail e senha)
-- e rode no SQL Editor:  insert into public.menu_owners (user_id) select id from auth.users where email = 'EMAIL_DO_DONO';

-- 1) Tabela do cardápio (um registro por restaurante, com o cardápio inteiro em JSON)
create table if not exists public.menus (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.menus enable row level security;

-- Qualquer pessoa (o cliente que escaneou o QR Code) pode LER o cardápio.
drop policy if exists "cardapio publico" on public.menus;
create policy "cardapio publico" on public.menus for select using (true);

-- Quem é dono. Só quem está nesta lista pode alterar (não basta ter conta no Supabase).
create table if not exists public.menu_owners (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.menu_owners enable row level security;
drop policy if exists "dono se ve" on public.menu_owners;
create policy "dono se ve" on public.menu_owners for select to authenticated using (user_id = auth.uid());

create or replace function public.is_menu_owner() returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.menu_owners where user_id = auth.uid()) $$;

-- Só o dono logado pode criar e alterar.
drop policy if exists "dono cria" on public.menus;
create policy "dono cria" on public.menus for insert to authenticated with check (public.is_menu_owner());
drop policy if exists "dono altera" on public.menus;
create policy "dono altera" on public.menus for update to authenticated using (public.is_menu_owner()) with check (public.is_menu_owner());

-- 2) Pasta pública para os modelos 3D e fotos
insert into storage.buckets (id, name, public)
values ('cardapio', 'cardapio', true)
on conflict (id) do update set public = true;

drop policy if exists "dono envia arquivos" on storage.objects;
create policy "dono envia arquivos" on storage.objects for insert to authenticated
  with check (bucket_id = 'cardapio' and public.is_menu_owner());
drop policy if exists "dono atualiza arquivos" on storage.objects;
create policy "dono atualiza arquivos" on storage.objects for update to authenticated
  using (bucket_id = 'cardapio' and public.is_menu_owner());
drop policy if exists "dono apaga arquivos" on storage.objects;
create policy "dono apaga arquivos" on storage.objects for delete to authenticated
  using (bucket_id = 'cardapio' and public.is_menu_owner());

-- Avisa o cardápio aberto quando o dono salva (atualiza na hora, sem recarregar)
do $$ begin
  alter publication supabase_realtime add table public.menus;
exception when others then null; end $$;
