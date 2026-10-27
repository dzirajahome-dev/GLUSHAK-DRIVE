create table if not exists public.site_users (
	id uuid primary key,
	name text not null check (char_length(btrim(name)) between 2 and 50),
	email text not null unique check (char_length(email) <= 254),
	role text not null check (role in ('user', 'admin')),
	password_salt text not null check (password_salt ~ '^[0-9a-f]{32}$'),
	password_hash text not null check (password_hash ~ '^[0-9a-f]{128}$'),
	created_at timestamptz not null default now()
);

create table if not exists public.site_sessions (
	token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
	user_id uuid not null references public.site_users(id) on delete cascade,
	expires_at timestamptz not null
);

create index if not exists site_sessions_user_id_idx on public.site_sessions(user_id);
create index if not exists site_sessions_expires_at_idx on public.site_sessions(expires_at);

create table if not exists public.site_auth_rate_limits (
	key text primary key,
	window_started_at timestamptz not null,
	request_count integer not null check (request_count > 0)
);

create index if not exists site_auth_rate_limits_window_idx on public.site_auth_rate_limits(window_started_at);

alter table public.site_users enable row level security;
alter table public.site_sessions enable row level security;
alter table public.site_auth_rate_limits enable row level security;

revoke all on table public.site_users, public.site_sessions, public.site_auth_rate_limits from public, anon, authenticated;
grant all on table public.site_users, public.site_sessions, public.site_auth_rate_limits to service_role;

create or replace function public.consume_site_auth_rate_limit(
	p_key text,
	p_maximum integer,
	p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	v_count integer;
begin
	if p_maximum < 1 or p_window_seconds < 1 or char_length(p_key) > 160 then
		return false;
	end if;

	insert into public.site_auth_rate_limits (key, window_started_at, request_count)
	values (p_key, clock_timestamp(), 1)
	on conflict (key) do update
	set window_started_at = case
			when site_auth_rate_limits.window_started_at <= clock_timestamp() - make_interval(secs => p_window_seconds)
				then clock_timestamp()
			else site_auth_rate_limits.window_started_at
		end,
		request_count = case
			when site_auth_rate_limits.window_started_at <= clock_timestamp() - make_interval(secs => p_window_seconds)
				then 1
			else site_auth_rate_limits.request_count + 1
		end
	returning request_count into v_count;

	return v_count <= p_maximum;
end;
$$;

create or replace function public.create_site_user(
	p_id uuid,
	p_name text,
	p_email text,
	p_salt text,
	p_password_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_user public.site_users%rowtype;
	v_role text;
begin
	perform pg_advisory_xact_lock(681029, 42);
	if exists (select 1 from public.site_users where email = lower(btrim(p_email))) then
		return null;
	end if;

	v_role := case
		when exists (select 1 from public.site_users where role = 'admin') then 'user'
		else 'admin'
	end;

	insert into public.site_users (id, name, email, role, password_salt, password_hash)
	values (p_id, btrim(p_name), lower(btrim(p_email)), v_role, p_salt, p_password_hash)
	returning * into v_user;

	return jsonb_build_object(
		'id', v_user.id,
		'name', v_user.name,
		'email', v_user.email,
		'role', v_user.role
	);
end;
$$;

revoke all on function public.consume_site_auth_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.create_site_user(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.consume_site_auth_rate_limit(text, integer, integer) to service_role;
grant execute on function public.create_site_user(uuid, text, text, text, text) to service_role;
