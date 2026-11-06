-- Cardápio 3D · estrutura na nuvem (Supabase)
-- Como usar: Supabase > SQL Editor > cole este arquivo > Run.
-- Depois: Authentication > Users > "Add user" para criar o login do dono (e-mail e senha).

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

-- Só o dono logado pode criar e alterar.
drop policy if exists "dono cria" on public.menus;
create policy "dono cria" on public.menus for insert to authenticated with check (true);
drop policy if exists "dono altera" on public.menus;
create policy "dono altera" on public.menus for update to authenticated using (true) with check (true);

-- 2) Pasta pública para os modelos 3D e fotos
insert into storage.buckets (id, name, public)
values ('cardapio', 'cardapio', true)
on conflict (id) do update set public = true;

drop policy if exists "dono envia arquivos" on storage.objects;
create policy "dono envia arquivos" on storage.objects for insert to authenticated
  with check (bucket_id = 'cardapio');
drop policy if exists "dono atualiza arquivos" on storage.objects;
create policy "dono atualiza arquivos" on storage.objects for update to authenticated
  using (bucket_id = 'cardapio');
