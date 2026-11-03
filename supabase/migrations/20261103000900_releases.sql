-- Desktop app releases: installers and the auto-update manifest (latest.json).
-- Private like the other buckets; the API serves them through /api/v1/updates.
insert into storage.buckets (id, name, public, file_size_limit)
values ('releases', 'releases', false, 209715200)  -- 200 MB per file
on conflict (id) do nothing;
