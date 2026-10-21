-- Photos, GIFs and videos attached to an X post (docs/dev/handoff-x-media.md). Each element is
-- {"type":"photo"|"gif","url":…,"alt":…} or {"type":"video","durationSeconds":…}. Photos and GIFs
-- are downloaded into the post's `<Title>_files/` folder like Substack images; videos are only
-- linked. The web API validates the elements; the database only keeps the shape sane.
alter table public.x_posts
  add column media jsonb not null default '[]'::jsonb
    check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 10);
