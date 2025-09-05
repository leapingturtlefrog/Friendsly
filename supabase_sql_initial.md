create table queue(
  id bigserial primary key,
  user_id uuid not null,
  name text,
  status text not null default 'queued',  -- queued|active|done
  enq_at timestamptz default now(),
  act_at timestamptz, left_at timestamptz
);
alter table queue enable row level security;
create unique index one_active on queue((status)) where status='active';
create unique index one_open_per_user on queue(user_id) where status in ('queued','active');

create policy q_ins on queue for insert with check (auth.uid()=user_id);
create policy q_sel_self on queue for select using (auth.uid()=user_id);
create policy q_upd_self on queue for update using (auth.uid()=user_id);

create or replace function promote_next()
returns table(id bigint,user_id uuid,name text,status text)
language sql security definer as $$
  update queue set status='active',act_at=now()
  where id=(
    select id from queue where status='queued' order by enq_at limit 1
  ) and not exists(select 1 from queue where status='active')
  returning id,user_id,name,status;
$$;

create or replace function release_active(p_user uuid)
returns void language sql security definer as $$
  update queue set status='done',left_at=now()
  where user_id=p_user and status='active';
$$;

grant execute on function promote_next() to authenticated;
grant execute on function release_active(uuid) to authenticated;

-- Drop the existing RLS policies that require authentication
DROP POLICY IF EXISTS q_ins ON queue;
DROP POLICY IF EXISTS q_sel_self ON queue;
DROP POLICY IF EXISTS q_upd_self ON queue;

-- Create new policies that allow public access
CREATE POLICY q_ins_public ON queue FOR INSERT WITH CHECK (true);
CREATE POLICY q_sel_public ON queue FOR SELECT USING (true);
CREATE POLICY q_upd_public ON queue FOR UPDATE USING (true);

-- Update the functions to not require authentication
CREATE OR REPLACE FUNCTION promote_next()
RETURNS table(id bigint,user_id uuid,name text,status text)
LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE queue SET status='active',act_at=now()
  WHERE id=(
    SELECT id FROM queue WHERE status='queued' ORDER BY enq_at LIMIT 1
  ) AND NOT EXISTS(SELECT 1 FROM queue WHERE status='active')
  RETURNING id,user_id,name,status;
$$;

CREATE OR REPLACE FUNCTION release_active(p_user uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE queue SET status='done',left_at=now()
  WHERE user_id=p_user AND status='active';
$$;

-- Grant execute permissions to anonymous users
GRANT EXECUTE ON FUNCTION promote_next() TO anon;
GRANT EXECUTE ON FUNCTION release_active(uuid) TO anon;