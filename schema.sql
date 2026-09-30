-- Run once in Supabase Dashboard > SQL Editor.
create table if not exists public.suppliers (
  id bigint generated always as identity primary key,
  name text not null unique,
  contact_name text,
  phone text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id bigint generated always as identity primary key,
  brand text not null,
  model text not null,
  size text not null,
  cost numeric(12,2) not null default 0 check (cost >= 0),
  price numeric(12,2) not null default 0 check (price >= 0),
  min_qty integer not null default 0 check (min_qty >= 0),
  stock_qty integer not null default 0 check (stock_qty >= 0),
  location text,
  created_at timestamptz not null default now(),
  unique (brand, model, size)
);

create table if not exists public.movements (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products(id),
  supplier_id bigint references public.suppliers(id),
  customer_name text,
  kind text not null check (kind in ('in','out')),
  qty integer not null check (qty > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  doc_ref text,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check ((kind = 'in' and supplier_id is not null) or (kind = 'out' and nullif(trim(customer_name), '') is not null))
);

create index if not exists movements_product_date_idx on public.movements(product_id, created_at desc);
create index if not exists movements_date_idx on public.movements(created_at desc);

alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.movements enable row level security;

drop policy if exists suppliers_staff on public.suppliers;
create policy suppliers_staff on public.suppliers for all to authenticated using (true) with check (true);
drop policy if exists products_staff on public.products;
create policy products_staff on public.products for all to authenticated using (true) with check (true);
drop policy if exists movements_read on public.movements;
create policy movements_read on public.movements for select to authenticated using (true);
drop policy if exists movements_insert on public.movements;
create policy movements_insert on public.movements for insert to authenticated with check (true);

create or replace function public.record_movement(
  p_product_id bigint,
  p_kind text,
  p_qty integer,
  p_supplier_id bigint default null,
  p_customer_name text default null,
  p_unit_price numeric default 0,
  p_doc_ref text default null,
  p_note text default null
) returns bigint
language plpgsql security invoker set search_path = public
as $$
declare v_stock integer; v_id bigint;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be positive'; end if;
  if p_kind not in ('in','out') then raise exception 'Invalid movement type'; end if;
  if p_kind = 'in' and p_supplier_id is null then raise exception 'Supplier is required'; end if;
  if p_kind = 'out' and nullif(trim(p_customer_name), '') is null then raise exception 'Customer name is required'; end if;
  select stock_qty into v_stock from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;
  if p_kind = 'out' and v_stock < p_qty then raise exception 'Not enough stock'; end if;
  update public.products set stock_qty = stock_qty + case when p_kind = 'in' then p_qty else -p_qty end where id = p_product_id;
  insert into public.movements(product_id, supplier_id, customer_name, kind, qty, unit_price, doc_ref, note)
  values (p_product_id, case when p_kind = 'in' then p_supplier_id else null end,
    case when p_kind = 'out' then trim(p_customer_name) else null end,
    p_kind, p_qty, coalesce(p_unit_price,0), nullif(trim(p_doc_ref),''), nullif(trim(p_note),''))
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.record_movement(bigint,text,integer,bigint,text,numeric,text,text) from public, anon;
grant execute on function public.record_movement(bigint,text,integer,bigint,text,numeric,text,text) to authenticated;
grant usage, select on all sequences in schema public to authenticated;
