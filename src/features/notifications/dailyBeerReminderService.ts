/**
 * dailyBeerReminderService.ts
 *
 * Schedules (and cancels) a local daily notification at 4:00 PM device-local time.
 * Copy is generic — no beer name or details are revealed.
 *
 * Design rules:
 *  - Never triggers a permission prompt; only schedules when permission is already granted.
 *  - Uses a stable identifier so re-scheduling replaces rather than duplicates.
 *  - On startup: re-schedules only if the notification is NOT already queued (survives updates).
 *  - On setting toggle: immediately schedules or cancels and updates local cache.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// ── Constants ──────────────────────────────────────────────────────────────────

const DAILY_REMINDER_CHANNEL_ID = 'hhs-daily-beer';
const DAILY_REMINDER_ID = 'hhs-daily-beer-4pm';
const DAILY_BEER_PREF_KEY = '@hhs:daily-beer-reminder-enabled';

// 4:00 PM device local time
const REMINDER_HOUR = 16;
const REMINDER_MINUTE = 0;

// ── October 2026 gate ──────────────────────────────────────────────────────────
// Daily beer reminders are only meaningful during the 31-day October 2026 event.
// All of October 2026 is PDT (UTC-7); DST ends on Nov 1, 2026.
//   Oct 1, 2026 00:00 PDT = Oct 1, 2026 07:00 UTC
//   Nov 1, 2026 00:00 PDT = Nov 1, 2026 07:00 UTC
const OCTOBER_2026_START_UTC = Date.UTC(2026, 9, 1, 7, 0, 0);   // Oct 1 00:00 PDT
const OCTOBER_2026_END_UTC   = Date.UTC(2026, 10, 1, 7, 0, 0);  // Nov 1 00:00 PDT (exclusive)

function isWithinOctober2026(): boolean {
  const now = Date.now();
  return now >= OCTOBER_2026_START_UTC && now < OCTOBER_2026_END_UTC;
}

// ── Rotating copy pool ─────────────────────────────────────────────────────────
// Generic beer-time prompts — no specific beer name or details revealed.
// Rotate by deterministic day-of-year index so the device gets variety over 31 days.

const COPY_POOL: Array<{ title: string; body: string }> = [
  { title: '🍺 Hallowed Hop Society', body: "It's beer o'clock! Today's selection is waiting for you in the app." },
  { title: '🍻 Society Hour', body: 'The tap is open. Your daily brew is ready to discover.' },
  { title: '🍺 Daily Pour', body: 'The society has poured your beer for the day — come see what it is.' },
  { title: '🍻 Hallowed Hop Society', body: 'Your beer of the day is live. Crack it open in the app!' },
  { title: '🍺 Time to Raise a Glass', body: "It's 4 PM — your daily HHS beer is ready and waiting." },
  { title: '🍻 Society Alert', body: 'Your daily selection has been served. Head over to see what arrived.' },
  { title: '🍺 Hallowed Hop Society', body: "Today's pour is in. Open the app and see what the society chose for you." },
  { title: '🍻 Beer O\'Clock', body: 'The Hallowed Hop Society toasts you — check in for today\'s beer.' },
  { title: '🍺 Your Daily Beer', body: 'The countdown is over. Pop into the app to see today\'s selection.' },
  { title: '🍻 Society Hour', body: 'Four o\'clock and all is well — your daily beer is ready.' },
  { title: '🍺 Hallowed Hop Society', body: 'Another day, another great beer from the society. Check it out!' },
  { title: '🍻 Daily Cheers', body: 'The tap is flowing. Your beer of the day is live in HHS.' },
  { title: '🍺 Time to Drink In', body: 'Society hour has arrived. Your daily pour is standing by in the app.' },
  { title: '🍻 Hallowed Hop Society', body: "It's been a good day — treat yourself. Today's beer is ready." },
  { title: '🍺 4 PM Reminder', body: 'The Hallowed Hop Society has your beer ready. Come see it!' },
  { title: '🍻 Your Beer Awaits', body: 'Daily selection is live. Head to HHS to discover today\'s brew.' },
  { title: '🍺 Society Pour', body: 'A fresh pour for a fresh day. Your HHS beer of the day is in.' },
  { title: '🍻 Hallowed Hop Society', body: 'Cheers! Your daily beer from the society is ready to reveal.' },
  { title: '🍺 Beer Time', body: 'The moment you\'ve been waiting for — today\'s HHS selection is up.' },
  { title: '🍻 Daily Revelation', body: 'Your beer has been chosen by the society. Open the app to see it.' },
  { title: '🍺 Hallowed Hop Society', body: 'Four o\'clock calls for a cold one. Your daily beer is live.' },
  { title: '🍻 Society Cheers', body: 'The daily pour is served. Check in with the Hallowed Hop Society.' },
  { title: '🍺 Beer O\'Clock', body: 'Today\'s society selection is ready and waiting just for you.' },
  { title: '🍻 Hallowed Hop Society', body: 'Your daily brew is in. See what the society picked for today!' },
  { title: '🍺 Time to Toast', body: 'Raise a glass — your HHS beer of the day is live in the app.' },
  { title: '🍻 Society Hour', body: 'The brew is ready. Open HHS and discover today\'s selection.' },
  { title: '🍺 Daily Beer Alert', body: 'Your Hallowed Hop Society beer for today has been revealed.' },
  { title: '🍻 Hallowed Hop Society', body: "4 PM means beer time. Don't keep today's pour waiting!" },
  { title: '🍺 Cheers from HHS', body: "Today's beer is live in the app. The society picked a good one." },
  { title: '🍻 Pour It Up', body: 'Society hour is officially open. Your daily selection is in.' },
  { title: '🍺 Hallowed Hop Society', body: 'Your daily beer from the society is ready — see what arrived today.' },
];

function pickCopy(): { title: string; body: string } {
  // Use day-of-year so messages cycle over the month without being random each time
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime();
  const dayOfYear = Math.floor(diff / 86_400_000);
  return COPY_POOL[dayOfYear % COPY_POOL.length];
}

// ── Android channel ────────────────────────────────────────────────────────────

async function ensureDailyBeerChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(DAILY_REMINDER_CHANNEL_ID, {
    name: 'Daily Beer Reminder',
    description: 'Daily 4 PM reminder to check your Hallowed Hop Society beer of the day.',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#C8962B',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: false,
  });
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Cancel the daily beer reminder if it is currently scheduled. */
export async function cancelDailyBeerReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_ID).catch(() => {
    // Not found / already cancelled — safe to ignore.
  });
}

/**
 * Schedule the daily beer reminder at 4:00 PM local time.
 * Only schedules during the October 2026 event window (Pacific time).
 * Cancels any existing scheduled instance first to avoid duplicates.
 * Outside October 2026, cancels any stale reminder and returns.
 */
export async function scheduleDailyBeerReminder(): Promise<void> {
  if (!isWithinOctober2026()) {
    // Outside the event window — cancel any stale reminder and do not schedule.
    await cancelDailyBeerReminder();
    return;
  }

  await ensureDailyBeerChannel();
  await cancelDailyBeerReminder();

  const { title, body } = pickCopy();

  await Notifications.scheduleNotificationAsync({
    identifier: DAILY_REMINDER_ID,
    content: {
      title,
      body,
      sound: 'default',
      ...(Platform.OS === 'android' && { channelId: DAILY_REMINDER_CHANNEL_ID }),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: REMINDER_HOUR,
      minute: REMINDER_MINUTE,
    },
  });
}

/**
 * Sync the daily beer reminder with a user-specified enabled/disabled preference.
 * - Caches the preference locally so startup sync can work without a network call.
 * - Outside the October 2026 event window: always cancels, even if enabled=true.
 * - If enabled: schedules (requires permission already granted — never requests).
 * - If disabled: cancels.
 */
export async function syncDailyBeerReminder(enabled: boolean): Promise<void> {
  // Persist preference locally for startup re-schedule after app updates.
  await AsyncStorage.setItem(DAILY_BEER_PREF_KEY, enabled ? '1' : '0').catch(() => {});

  if (!enabled || !isWithinOctober2026()) {
    await cancelDailyBeerReminder();
    return;
  }

  // Only schedule if permission is already granted — never auto-prompt.
  const { status } = await Notifications.getPermissionsAsync().catch(() => ({ status: 'undetermined' as const }));
  if (status !== 'granted') return;

  await scheduleDailyBeerReminder();
}

/**
 * Called once on app startup.
 * Re-schedules the reminder only if it is not already queued (handles app updates
 * that may clear scheduled notifications) and the user preference allows it.
 * Never requests notification permission.
 * Outside the October 2026 event window: cancels any stale reminder and returns.
 */
export async function syncDailyBeerReminderOnStartup(): Promise<void> {
  try {
    // Outside the October 2026 event window — cancel any stale reminder silently.
    if (!isWithinOctober2026()) {
      await cancelDailyBeerReminder();
      return;
    }

    // If already scheduled, nothing to do.
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const alreadyQueued = scheduled.some((n) => n.identifier === DAILY_REMINDER_ID);
    if (alreadyQueued) return;

    // Read locally-cached preference (defaults to enabled, matching DEFAULT_NOTIFICATION_PREFERENCES).
    const cachedPref = await AsyncStorage.getItem(DAILY_BEER_PREF_KEY).catch(() => null);
    const enabled = cachedPref === null ? true : cachedPref === '1';
    if (!enabled) return;

    // Only schedule if permission is already granted.
    const { status } = await Notifications.getPermissionsAsync().catch(() => ({ status: 'undetermined' as const }));
    if (status !== 'granted') return;

    await scheduleDailyBeerReminder();
  } catch {
    // Startup sync failure is non-fatal; silently ignore.
  }
}
