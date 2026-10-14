create table if not exists public.orders (
	id uuid primary key,
	user_id uuid not null,
	message text not null check (char_length(btrim(message)) between 5 and 5000),
	quantity integer not null default 1 check (quantity between 1 and 6),
	total_amount_grosze bigint not null default 2000 check (total_amount_grosze > 0),
	payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'cancelled')),
	status text not null default 'new' check (status in ('new', 'in-progress', 'completed', 'cancelled')),
	created_at timestamptz not null default now(),
	updated_at timestamptz,
	attachment jsonb
);

alter table public.orders add column if not exists quantity integer not null default 1;
alter table public.orders add column if not exists total_amount_grosze bigint not null default 2000;
alter table public.orders add column if not exists payment_status text not null default 'pending';
update public.orders set total_amount_grosze = quantity * 2000;
do $$
begin
	alter table public.orders add constraint orders_total_amount_check
		check (total_amount_grosze > 0);
exception when duplicate_object then
	null;
end;
$$;

do $$
begin
	alter table public.orders add constraint orders_payment_status_check
		check (payment_status in ('pending', 'paid', 'cancelled'));
exception when duplicate_object then
	null;
end;
$$;
alter table public.orders enable row level security;
create index if not exists orders_user_created_idx on public.orders (user_id, created_at desc);
create index if not exists orders_created_status_idx on public.orders (created_at desc, status);

revoke all on table public.orders from public, anon, authenticated;
grant all on table public.orders to service_role;

drop function if exists public.create_order_if_capacity(uuid, uuid, text, integer, text, timestamptz, jsonb);
create or replace function public.create_order_if_capacity(
	p_id uuid,
	p_user_id uuid,
	p_message text,
	p_quantity integer,
	p_status text,
	p_created_at timestamptz,
	p_attachment jsonb,
	p_total_amount_grosze bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_week_start timestamptz := date_trunc('week', now() at time zone 'UTC') at time zone 'UTC';
	v_used integer;
	v_order public.orders%rowtype;
begin
	perform pg_advisory_xact_lock(681029, 6);
	if p_quantity not between 1 and 6 or p_total_amount_grosze <> p_quantity * 2000 then
		raise exception 'Invalid order quantity or total amount.';
	end if;

	select coalesce(sum(quantity), 0)::integer into v_used
	from public.orders
	where status <> 'cancelled'
		and created_at >= v_week_start
		and created_at < v_week_start + interval '7 days';

	if v_used + p_quantity > 6 then
		raise exception using errcode = 'P0001', message = 'WEEKLY_ORDER_CAPACITY';
	end if;

	insert into public.orders (id, user_id, message, quantity, total_amount_grosze, payment_status, status, created_at, attachment)
	values (p_id, p_user_id, p_message, p_quantity, p_total_amount_grosze, 'pending', p_status, p_created_at, p_attachment)
	returning * into v_order;

	return jsonb_build_object(
		'order', to_jsonb(v_order),
		'capacity', jsonb_build_object(
			'limit', 6,
			'used', v_used + p_quantity,
			'remaining', 6 - v_used - p_quantity,
			'weekStartsAt', v_week_start
		)
	);
end;
$$;

create or replace function public.update_order_status_if_capacity(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_week_start timestamptz := date_trunc('week', now() at time zone 'UTC') at time zone 'UTC';
	v_used integer;
	v_order public.orders%rowtype;
begin
	perform pg_advisory_xact_lock(681029, 6);

	select * into v_order from public.orders where id = p_id for update;
	if not found then
		return null;
	end if;

	if v_order.status = 'cancelled' and p_status <> 'cancelled'
		and v_order.created_at >= v_week_start
		and v_order.created_at < v_week_start + interval '7 days' then
		select coalesce(sum(quantity), 0)::integer into v_used
		from public.orders
		where status <> 'cancelled'
			and created_at >= v_week_start
			and created_at < v_week_start + interval '7 days';
		if v_used + v_order.quantity > 6 then
			raise exception using errcode = 'P0001', message = 'WEEKLY_ORDER_CAPACITY';
		end if;
	end if;

	update public.orders
	set status = p_status, updated_at = now()
	where id = p_id
	returning * into v_order;

	select coalesce(sum(quantity), 0)::integer into v_used
	from public.orders
	where status <> 'cancelled'
		and created_at >= v_week_start
		and created_at < v_week_start + interval '7 days';

	return jsonb_build_object(
		'order', to_jsonb(v_order),
		'capacity', jsonb_build_object(
			'limit', 6,
			'used', v_used,
			'remaining', greatest(0, 6 - v_used),
			'weekStartsAt', v_week_start
		)
	);
end;
$$;

revoke execute on function public.create_order_if_capacity(uuid, uuid, text, integer, text, timestamptz, jsonb, bigint) from public, anon, authenticated;
revoke execute on function public.update_order_status_if_capacity(uuid, text) from public, anon, authenticated;
grant execute on function public.create_order_if_capacity(uuid, uuid, text, integer, text, timestamptz, jsonb, bigint) to service_role;
grant execute on function public.update_order_status_if_capacity(uuid, text) to service_role;
