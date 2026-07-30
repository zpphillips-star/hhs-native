# HHS Native Migration — Phase 0 Inventory and Phase 1 Plan

Date: 2026-07-28

## Scope guard

This document is inventory/planning only. It does not change app runtime behavior, app versions, build settings, release artifacts, Supabase schema, or production data.

The migration goal is to move Hallowed Hop Society from a WebView-based Expo shell to a true Expo/React Native app while preserving existing production behavior and Zach's manual release workflow.

## Repositories located

| Repo | Path | Role |
|---|---|---|
| Web app | `C:\Users\zaphilli\code\hhs-app-clone` | Current production Next.js app, Supabase client/API routes, admin, PWA/web push |
| Native app | `C:\Users\zaphilli\hhs-native` | Current Expo app shell around production web app, push registration/settings, native first-login membership/Venmo overlay |

## Current architecture summary

### Web app

- Next.js app router with client pages under `app/`.
- Supabase browser client in `lib/supabase.ts`.
- Server API routes use `@supabase/supabase-js` with `SUPABASE_SECRET_KEY` for admin/service-role side effects.
- Main production navigation exposes:
  - `/beers` — The Beer
  - `/wall` — The Wall
  - `/leaderboard` — The Rankings
  - `/auth` for unauthenticated users
- Additional routes:
  - `/feedback`, `/admin/feedback`
  - `/admin`
  - `/welcome`
  - `/auth/complete`, `/auth/payment`, `/auth/forgot-password`, `/auth/reset-password`
  - `/kanban` for brewery outreach operations

### Native app

- Single-file Expo app: `App.tsx`.
- Current foundation is `react-native-webview` loading `https://hallowedhopsociety.com/`.
- Native-only code currently handles:
  - WebView bridge user detection.
  - First-login overlay for notification permission, tier selection, and Venmo open.
  - Expo push token registration via web API.
  - Local and backend notification preference sync.
  - Native hamburger/settings overlay.
  - Back-button behavior and external-link routing.
- There is no native routing, Supabase client, or native screen/component structure yet.

## Route/data migration matrix

| Production route/screen | Current files | Tables/views/RPCs | Storage | Auth requirement | Writes / side effects | Native target |
|---|---|---|---|---|---|---|
| Home / current daily teaser | `app/page.tsx` | `beers`, `ratings` | none | Public read; rating requires user | `ratings.upsert` on rate | Native later or merge into Beer; not Phase 1 critical |
| Beer | `app/beers/page.tsx` | `beers`, `ratings`, `posts`, `post_reactions`, `post_comments`, `profiles` | `post-photos` public bucket | Read mostly public; rating/post/reaction require auth user | `ratings.upsert`; `posts.insert`; direct `post_reactions.insert/delete`; photo upload to `post-photos` | Native Phase 2 core. Phase 1 should create data layer/types and auth/session foundation for this screen. |
| The Wall | `app/wall/page.tsx`; `app/api/wall/react/route.ts`; `app/api/wall/comment/route.ts` | `posts`, `post_reactions`, `post_comments`, `profiles`, joined `beers`, `app_settings` | `post-photos` public bucket | Page gates unauthenticated users; writes require user | `posts.insert/delete`; photo upload; `/api/wall/react` toggles reactions and sends Expo push; `/api/wall/comment` inserts comments and sends Expo push; tier modal can update `profiles` | Native Phase 2/3 core. Keep web fallback until native list/post/photo/comment/reaction parity exists. |
| Rankings | `app/leaderboard/page.tsx` | `ratings`, `posts`, `post_comments`, `post_reactions`, `profiles`, joined `beers` | none | Public read; user only used for nav state | Read-only client aggregation | Native Phase 2 after Beer data layer; can be pure native using same read queries. |
| Feedback board | `app/feedback/page.tsx`; `app/admin/feedback/page.tsx`; `app/api/feedback/route.ts`; `app/api/feedback/upload/route.ts` | `feedback_items` | `feedback-images` public bucket | Public read/submit; admin status changes require Supabase session bearer token | Submit feedback; upload images via server route; admin PATCH status | Temporary web fallback or native Phase 3. If native, prefer server APIs first; verify bucket/public URL before native uploads. |
| Settings / notification prefs | Native `App.tsx`; `app/api/notification-preferences/route.ts`; `app/api/push-token/route.ts`; `lib/expo-push.ts` | `notification_preferences`, `expo_push_tokens` | none | Native requires known user id; APIs currently service-role by user_id | Request native notification permission; register Expo token; upsert prefs; local AsyncStorage cache | Native Phase 1 foundation. Keep and modularize; replace WebView dependency for identity. |
| Auth sign-in/request | `app/auth/page.tsx`; `app/api/request-access/route.ts` | Supabase Auth, `member_requests` | none | Sign-in public; membership request public | `supabase.auth.signInWithPassword`; request access inserts/updates `member_requests`; sends Resend email to HHS | Native Phase 1 foundation. Implement native sign-in/session persistence; membership request can call existing API. |
| Auth complete/password reset | `app/auth/complete/page.tsx`; `app/auth/forgot-password/page.tsx`; `app/auth/reset-password/page.tsx` | Supabase Auth, `profiles` | none | User/session or recovery token | `auth.updateUser`; `profiles.upsert`; password reset email | Web-only/temporary fallback initially. Deep-link recovery needs separate native design before replacing. |
| Membership / Venmo | `app/auth/payment/page.tsx`; `components/TierSelectionModal.tsx`; `app/api/native-membership/route.ts`; native `App.tsx` | `profiles`, `app_settings` | none | Auth user | `profiles.tier`, `tier_selected_at`, `venmo_clicked_at`, native amount/source fields; Venmo deep links to `zpphillips` | Native Phase 1/2. Preserve single-recipient Venmo behavior: native currently omits note and web fallback query params. |
| Admin | `app/admin/page.tsx`; `app/api/approve-member/route.ts`; `app/api/notify/route.ts`; `app/api/subscribe/route.ts`; `app/api/admin/test-push/route.ts` | `beers`, `profiles`, `member_requests`, `push_subscriptions`, `notification_log`, `notification_opens`, `app_settings`, Expo tables via `notify` | none | Currently any authenticated user/client route; service APIs use secrets/server-side | Beer CRUD; approve/reject member and send emails; web-push broadcast; Expo broadcast; tier selection toggle | Web-only. Do not migrate to native in Phase 1. |
| Brewery outreach kanban | `app/kanban/page.tsx`; `supabase/migrations/20260512_brewery_outreach.sql` | `brewery_outreach` | none | Current RLS allows anon select/update | Update outreach status/notes/order data | Web-only. Not part of member native app. |
| Welcome / PWA setup | `app/welcome/page.tsx`; `components/SetupGuide.tsx`; `components/SetupBanner.tsx`; `app/api/subscribe/route.ts` | `profiles`, `push_subscriptions` | none | User for setup writes | Web PWA install tracking and web push subscription | Web-only; native should replace with native notification onboarding/settings. |

## Supabase assets inventoried

### Tables and columns from migrations

- `profiles`: base `id`, `username`, `display_name`, `created_at`; extended with `status`, `tier`, `first_name`, `last_name`, `has_pwa`, `tier_selected_at`, `venmo_clicked_at`, `email`, `display_name_native`, `native_membership_amount`, `native_source`.
- `beers`: `day_number`, `name`, `brewery`, `style`, `abv`, `description`, `image_url`, plus `ai_notes`.
- `ratings`: one row per `user_id`/`beer_id`.
- `posts`, `post_reactions`, `post_comments`: wall and beer discussion.
- `member_requests`: membership queue.
- `app_settings`: single row, currently `tier_selection_open`.
- `feedback_items`: roadmap/feedback board.
- `expo_push_tokens`, `notification_preferences`: native push.
- `notification_log`, `notification_opens`: notification tracking.
- `push_subscriptions`: used by code for web push, but no matching migration file was found during this inventory.
- `brewery_outreach`: outreach tracker.

### Storage buckets

- `post-photos`: public, used by Beer and Wall for member photos.
- `feedback-images`: public, used by feedback image uploads through `/api/feedback/upload`.

### RPCs/views

- No Supabase RPC calls (`rpc(...)`) were found in the inspected web/native code.
- No application views were found in the inspected migration files.

## What to keep vs replace in native

### Keep

- Expo app config, package identity, icons/splash, notification plugin, Android permissions, deep-link scheme/intent filters.
- Native Venmo safety rule: single recipient `zpphillips`; avoid note/query fields that can confuse Venmo parsing.
- Native Expo push permission/token registration concept and existing backend endpoints.
- Notification preference defaults and category names.
- Zach-controlled manual Play Store workflow; no auto-upload.

### Replace

- WebView as primary app surface.
- WebView bridge auth detection and localStorage token clearing.
- Injected JavaScript used to suppress web install prompts/native menu.
- Single `App.tsx` monolith.
- Web-only navigation assumptions and document navigation.

### Add for true native foundation

- Native project structure:
  - `src/lib/supabase.ts`
  - `src/lib/api.ts`
  - `src/lib/storage.ts`
  - `src/features/auth/*`
  - `src/features/beer/*`
  - `src/features/wall/*`
  - `src/features/settings/*`
  - `src/navigation/*`
  - `src/types/hhs.ts`
- `@supabase/supabase-js` in native app.
- `react-native-url-polyfill` and AsyncStorage-backed Supabase auth storage.
- Native navigation (`@react-navigation/native` or Expo Router), selected before coding screens.
- Typed data helpers for current tables and server API endpoints.
- Explicit temporary fallback policy for screens that remain web-only during migration.

## Phase 1 implementation task list — native foundation only

1. Choose and install navigation/auth dependencies:
   - Supabase JS + URL polyfill.
   - Navigation package or Expo Router.
   - Keep WebView dependency temporarily only if a fallback screen is needed.
2. Split current `App.tsx` into modules without changing behavior first:
   - colors/constants
   - notification prefs/token service
   - Venmo URL helpers
   - first-login/membership flow state
3. Add native Supabase client:
   - Use `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` or agreed env names.
   - Persist session in AsyncStorage.
   - Do not use service-role keys in native.
4. Build auth/session provider:
   - hydrate session on app start
   - sign in with email/password
   - sign out through Supabase client and clear native-only caches as needed
   - expose current user id/email to push/settings/membership flows
5. Build minimal native navigation shell:
   - signed-out: Auth
   - signed-in: Beer, Wall, Rankings, Settings tabs/placeholders
   - web-only fallback entry points only for Admin, password reset/complete, feedback if not yet native
6. Port notification foundation:
   - request permission
   - create Android channel
   - register Expo token through `/api/push-token`
   - fetch/upsert `/api/notification-preferences`
   - retain explicit defaults
7. Port membership foundation:
   - fetch profile tier/state
   - select tier/update via existing `/api/native-membership` or direct RLS-safe profile update when session is ready
   - open Venmo with native safe single-recipient URL
8. Add typed HHS data services:
   - `getBeers`, `getTodayBeer`, `getRating`, `upsertRating`
   - `getWallPosts`, `createWallPost`, `deleteOwnPost`
   - `reactToPost`, `commentOnPost` through existing server APIs to preserve notification side effects
9. Verification for Phase 1:
   - TypeScript check only.
   - No build/release unless explicitly requested.
   - Manual smoke checklist on Expo dev client/emulator if credentials/environment are available.

## First recommended coding step

Start with the native repo foundation, not UI redesign:

1. Add native Supabase/auth dependencies.
2. Create `src/lib/supabase.ts` with AsyncStorage-backed session persistence.
3. Create an `AuthProvider` that hydrates the current user and supports sign-in/sign-out.
4. Keep the existing WebView shell reachable until the first native Beer screen can read `beers` and `ratings`.

