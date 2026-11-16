# Backend contract fixtures

`backend-zones.json` and `backend-places.json` are snapshots of the Python literals in
`backend/data/mock_zones.py` and `backend/data/mock_places.py` at `c6ec2f6`.
They are sample data, not predictions or live search results.

The frontend compatibility and HTTP-mode browser tests use these fixtures without
requiring a Supabase account, provider credentials, or email delivery. Refresh the
snapshots from the backend literals when their contract changes; do not weaken the
frontend validation just to accept arbitrary invalid server data.
