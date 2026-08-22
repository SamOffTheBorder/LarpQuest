-- User-level Appearance preferences (theme preset, accent hue, font pairing,
-- text scale). Not story-scoped — one row per user, upserted as a singleton.

create table user_preferences (
  user_id uuid primary key references auth.users on delete cascade,
  theme_preset text not null default 'dark-arcane'
    check (theme_preset in ('dark-arcane', 'parchment', 'midnight')),
  accent_hue int not null default 300
    check (accent_hue in (300, 155, 25, 85, 235)),
  font_pairing text not null default 'cinzel-spectral'
    check (font_pairing in ('cinzel-spectral', 'cormorant-garamond', 'marcellus-crimson-pro')),
  text_scale int not null default 2 check (text_scale between 0 and 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table user_preferences enable row level security;

create policy user_preferences_select on user_preferences
  for select using (user_id = (select auth.uid()));

create policy user_preferences_insert on user_preferences
  for insert with check (user_id = (select auth.uid()));

create policy user_preferences_update on user_preferences
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy user_preferences_delete on user_preferences
  for delete using (user_id = (select auth.uid()));

create trigger user_preferences_touch_updated_at
  before update on user_preferences
  for each row execute function touch_updated_at();
