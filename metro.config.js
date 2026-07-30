// metro.config.js — Expo SDK 54 default config with env-aware cache keys.
//
// WHY THIS FILE EXISTS:
// babel-preset-expo inlines process.env.EXPO_PUBLIC_* values at Babel transform
// time (production builds). Metro caches those transforms keyed on the source
// file hash, NOT on the environment variable values. If the .env file is
// populated AFTER an initial bundle was cached, subsequent builds reuse the
// stale cache and the env vars stay as `undefined` at runtime.
//
// Adding the EXPO_PUBLIC_* values to the project-level cache key forces Metro
// to invalidate every transform whenever the public env vars change.
//
// See: https://docs.expo.dev/guides/environment-variables/#bare-workflow-setup

const { getDefaultConfig } = require('expo/metro-config');
const crypto = require('crypto');

// Load EXPO_PUBLIC_* values from process.env (already set by @expo/env before
// this file is required) and fold them into a stable hash for the cache key.
function getPublicEnvHash() {
  const publicEnvEntries = Object.entries(process.env)
    .filter(([key]) => key.startsWith('EXPO_PUBLIC_'))
    .sort(([a], [b]) => a.localeCompare(b));
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(publicEnvEntries))
    .digest('hex')
    .slice(0, 16);
}

const config = getDefaultConfig(__dirname);

// Append a short hash of the current public env vars to the cache version so
// that changes in .env automatically bust the transform cache.
const envHash = getPublicEnvHash();
config.cacheVersion = `expo-sdk54-env-${envHash}`;

module.exports = config;
