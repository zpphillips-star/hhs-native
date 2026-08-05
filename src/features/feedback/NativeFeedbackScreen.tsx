/**
 * NativeFeedbackScreen
 *
 * Layout:
 *   • Header: back button · "Roadmap & Feedback" title · "+ Suggest" button
 *   • Optional collapsible suggestion form (slides open/close)
 *   • Success toast after submit
 *   • 4 stage accordion columns: Submitted | Planned | In Progress | Live ✓
 *   • Pull-to-refresh on the whole scroll view
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { useAuth } from '../auth/AuthProvider';
import { HHS_COLORS, HHS_STYLES, HHS_TYPOGRAPHY } from '../../theme/hhsTheme';
import {
  FEEDBACK_STAGES,
  fetchFeedbackItems,
  submitFeedbackItem,
  type FeedbackItem,
  type FeedbackStage,
  type FeedbackStatus,
} from './feedbackService';

const COLORS = HHS_COLORS;

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

// ─── Stage accordion section ──────────────────────────────────────────────────

type StageSectionProps = {
  stage: FeedbackStage;
  items: FeedbackItem[];
  defaultOpen: boolean;
};

function StageSection({ stage, items, defaultOpen }: StageSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View
      style={[
        styles.stageContainer,
        { borderColor: stage.borderColor, backgroundColor: open ? stage.bg : 'rgba(255,255,255,0.01)' },
      ]}
    >
      {/* Section header — tap to expand/collapse */}
      <TouchableOpacity
        activeOpacity={0.78}
        onPress={() => setOpen((v) => !v)}
        style={styles.stageHeader}
        accessibilityRole="button"
        accessibilityLabel={`${stage.label} — ${items.length} items`}
      >
        {/* Color accent bar */}
        <View style={[styles.stageAccent, { backgroundColor: stage.color }]} />

        <View style={styles.stageHeaderText}>
          <View style={styles.stageHeaderRow}>
            <Text style={[styles.stageLabel, { color: stage.color }]}>{stage.label}</Text>
            <View style={[styles.stageBadge, { backgroundColor: `${stage.color}22` }]}>
              <Text style={[styles.stageBadgeText, { color: stage.color }]}>{items.length}</Text>
            </View>
          </View>
          <Text style={styles.stageDescription}>{stage.description}</Text>
        </View>

        {/* Chevron */}
        <Text style={[styles.stageChevron, { color: stage.color }, open && styles.stageChevronOpen]}>
          ›
        </Text>
      </TouchableOpacity>

      {/* Items list */}
      {open ? (
        <View style={[styles.stageItems, { borderTopColor: stage.borderColor }]}>
          {items.length === 0 ? (
            <Text style={styles.emptyText}>
              {stage.id === 'submitted' ? 'No suggestions yet — tap "+ Suggest" above' : 'Nothing here yet'}
            </Text>
          ) : (
            items.map((item) => (
              <View key={item.id} style={styles.itemCard}>
                <View style={styles.itemRow}>
                  <Text style={styles.itemTitle}>{item.title}</Text>
                  <Text style={styles.itemDate}>{formatDate(item.created_at)}</Text>
                </View>
                {item.description ? (
                  <Text style={styles.itemDescription}>{item.description}</Text>
                ) : null}
                {item.name ? <Text style={styles.itemAuthor}>— {item.name}</Text> : null}
              </View>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

// ─── Suggestion form modal ─────────────────────────────────────────────────────

type SuggestionFormProps = {
  visible: boolean;
  userEmail?: string;
  onClose: () => void;
  onSuccess: () => void;
};

function SuggestionFormModal({ visible, userEmail, onClose, onSuccess }: SuggestionFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle('');
    setDescription('');
    setName('');
    setError(null);
    setSubmitting(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (submitting || !title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitFeedbackItem({
        title: title.trim(),
        description: description.trim() || undefined,
        name: name.trim() || undefined,
        email: userEmail,
      });
      reset();
      onSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to submit. Please try again.';
      setError(message);
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      {/*
       * KeyboardAvoidingView lifts the sheet off the keyboard.
       *   iOS  → 'padding' pushes the bottom inset up (standard for bottom-sheets)
       *   Android → 'height' shrinks the KAV container so the sheet re-anchors above
       *             the keyboard (undefined did nothing before this fix)
       */}
      <KeyboardAvoidingView
        style={styles.modalBg}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modalSheet}>
          {/* Handle — sits outside the scroll so it stays pinned at the top */}
          <View style={styles.modalHandle} />

          {/*
           * ScrollView lets the user scroll the form content if the keyboard
           * still obscures lower fields on very small devices.
           * keyboardShouldPersistTaps="handled" keeps the keyboard open when
           * the user taps an action button instead of dismissing it first.
           */}
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.formScrollContent}
          >
            <Text style={styles.modalKicker}>Hallowed Hop Society</Text>
            <Text style={styles.modalTitle}>Suggest a Feature</Text>
            <Text style={styles.modalSubtitle}>
              Tell the Society what to build next. Your suggestion goes straight to the shared roadmap.
            </Text>

            {error ? <Text style={styles.formError}>{error}</Text> : null}

            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder='Short title (e.g. "Show tap list nearby")'
              placeholderTextColor="rgba(166,157,141,0.55)"
              editable={!submitting}
              maxLength={120}
            />
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Describe your idea in more detail…"
              placeholderTextColor="rgba(166,157,141,0.55)"
              editable={!submitting}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              maxLength={600}
            />
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={userEmail ? `Your name (optional) · ${userEmail}` : 'Your name (optional)'}
              placeholderTextColor="rgba(166,157,141,0.55)"
              editable={!submitting}
              maxLength={80}
            />

            <TouchableOpacity
              style={[styles.submitButton, (!title.trim() || submitting) && styles.buttonDisabled]}
              onPress={() => void handleSubmit()}
              activeOpacity={0.85}
              disabled={submitting || !title.trim()}
            >
              <Text style={styles.submitButtonText}>
                {submitting ? 'Submitting…' : 'Submit Suggestion'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelButton} onPress={handleClose} activeOpacity={0.75}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export type NativeFeedbackScreenProps = {
  onBack: () => void;
};

export function NativeFeedbackScreen({ onBack }: NativeFeedbackScreenProps) {
  const { user } = useAuth();

  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);

  // Mounted guard: prevents the Supabase callback from calling setState after
  // the user presses back and this component unmounts mid-fetch.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadItems = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setLoadError(null);
    try {
      const data = await fetchFeedbackItems();
      if (!mountedRef.current) return;
      setItems(data);
    } catch (err) {
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : 'Could not load feedback items.';
      setLoadError(message);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const handleSubmitSuccess = () => {
    setFormVisible(false);
    setJustSubmitted(true);
    setTimeout(() => setJustSubmitted(false), 5000);
    void loadItems(true);
  };

  // Group items by status for each stage column
  const grouped = FEEDBACK_STAGES.reduce<Record<FeedbackStatus, FeedbackItem[]>>(
    (acc, stage) => {
      acc[stage.id] = items.filter((item) => item.status === stage.id);
      return acc;
    },
    { submitted: [], backlog: [], in_progress: [], live: [] },
  );

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <StatusBar style="light" backgroundColor={COLORS.background} />

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onBack}
            style={styles.backButton}
            activeOpacity={0.82}
            accessibilityLabel="Back"
          >
            <Text style={styles.backButtonText}>‹</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerKicker}>Hallowed Hop Society</Text>
            <Text style={styles.headerTitle}>Roadmap & Feedback</Text>
          </View>
          <TouchableOpacity
            onPress={() => setFormVisible(true)}
            style={styles.suggestButton}
            activeOpacity={0.82}
          >
            <Text style={styles.suggestButtonText}>+ Suggest</Text>
          </TouchableOpacity>
        </View>

        {/* Body */}
        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={COLORS.gold} size="large" />
            <Text style={styles.loadingText}>Loading feedback board…</Text>
          </View>
        ) : loadError ? (
          <View style={styles.errorState}>
            <Text style={styles.errorTitle}>Couldn't load feedback</Text>
            <Text style={styles.errorBody}>{loadError}</Text>
            <TouchableOpacity onPress={() => void loadItems()} style={styles.retryButton} activeOpacity={0.85}>
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            refreshControl={
              <RefreshControl
                colors={[COLORS.gold]}
                onRefresh={() => void loadItems(true)}
                refreshing={refreshing}
                tintColor={COLORS.gold}
              />
            }
          >
            {/* Success toast */}
            {justSubmitted ? (
              <View style={styles.successToast}>
                <Text style={styles.successToastText}>
                  ✓ Thanks! Your suggestion is under review.
                </Text>
              </View>
            ) : null}

            {/* Kanban stage sections */}
            {FEEDBACK_STAGES.map((stage) => (
              <StageSection
                key={stage.id}
                stage={stage}
                items={grouped[stage.id]}
                defaultOpen={stage.id === 'submitted' || stage.id === 'in_progress'}
              />
            ))}

            <Text style={styles.footer}>hallowedhopsociety.com</Text>
          </ScrollView>
        )}

        {/* Suggestion form modal */}
        <SuggestionFormModal
          visible={formVisible}
          userEmail={user?.email}
          onClose={() => setFormVisible(false)}
          onSuccess={handleSubmitSuccess}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.background,
    flex: 1,
  },

  // ── Header ──
  header: {
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  backButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  backButtonText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.gold,
    fontSize: 28,
    lineHeight: 32,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerKicker: {
    ...HHS_TYPOGRAPHY.kicker,
    color: COLORS.gold,
    fontSize: 9,
  },
  headerTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
  },
  suggestButton: {
    backgroundColor: COLORS.gold,
    borderRadius: HHS_STYLES.buttonRadius,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  suggestButtonText: {
    ...HHS_TYPOGRAPHY.button,
    color: '#191726',
    fontSize: 11,
    fontWeight: '700',
  },

  // ── Loading / error states ──
  loadingState: {
    alignItems: 'center',
    flex: 1,
    gap: 14,
    justifyContent: 'center',
    padding: 32,
  },
  loadingText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 14,
  },
  errorState: {
    alignItems: 'center',
    flex: 1,
    gap: 10,
    justifyContent: 'center',
    padding: 32,
  },
  errorTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorBody: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 13,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: COLORS.goldDim,
    borderColor: COLORS.border,
    borderRadius: HHS_STYLES.buttonRadius,
    borderWidth: 1,
    marginTop: 6,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  retryButtonText: {
    ...HHS_TYPOGRAPHY.button,
    color: COLORS.gold,
    fontSize: 13,
  },

  // ── Scroll body ──
  scrollContent: {
    padding: 14,
    paddingBottom: 32,
  },
  successToast: {
    backgroundColor: 'rgba(95,166,95,0.1)',
    borderColor: 'rgba(95,166,95,0.22)',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
  },
  successToastText: {
    ...HHS_TYPOGRAPHY.body,
    color: '#8fd48f',
    fontSize: 13,
    textAlign: 'center',
  },
  footer: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 12,
    opacity: 0.55,
    textAlign: 'center',
  },

  // ── Stage accordion ──
  stageContainer: {
    borderRadius: HHS_STYLES.cardRadius,
    borderWidth: 1,
    marginBottom: 10,
    overflow: 'hidden',
  },
  stageHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  stageAccent: {
    borderRadius: 2,
    height: 32,
    width: 4,
  },
  stageHeaderText: {
    flex: 1,
  },
  stageHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  stageLabel: {
    ...HHS_TYPOGRAPHY.kicker,
    fontSize: 12,
    fontWeight: '700',
  },
  stageBadge: {
    borderRadius: HHS_STYLES.pillRadius,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  stageBadgeText: {
    ...HHS_TYPOGRAPHY.body,
    fontSize: 11,
    fontWeight: '700',
  },
  stageDescription: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 2,
  },
  stageChevron: {
    fontSize: 24,
    lineHeight: 28,
    transform: [{ rotate: '90deg' }],
  },
  stageChevronOpen: {
    transform: [{ rotate: '270deg' }],
  },
  stageItems: {
    borderTopWidth: 1,
    padding: 14,
    paddingTop: 8,
  },
  emptyText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 12,
    paddingVertical: 14,
    textAlign: 'center',
  },
  itemCard: {
    backgroundColor: 'rgba(25,23,38,0.7)',
    borderColor: 'rgba(217,124,43,0.12)',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    padding: 12,
  },
  itemRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  itemTitle: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.text,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  itemDate: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    flexShrink: 0,
    fontSize: 10,
    marginTop: 2,
    opacity: 0.7,
  },
  itemDescription: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  itemAuthor: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 6,
    opacity: 0.75,
  },

  // ── Suggestion form modal ──
  modalBg: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.borderStrong,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    // paddingBottom lives in formScrollContent so the ScrollView absorbs it
    paddingHorizontal: 20,
    paddingTop: 12,
    // Cap height so the sheet never exceeds ~80 % of the viewport on small
    // screens; content scrolls inside the ScrollView instead.
    maxHeight: '82%',
  },
  formScrollContent: {
    paddingBottom: 40,
  },
  modalHandle: {
    alignSelf: 'center',
    backgroundColor: COLORS.borderStrong,
    borderRadius: 999,
    height: 4,
    marginBottom: 18,
    width: 42,
  },
  modalKicker: {
    ...HHS_TYPOGRAPHY.kicker,
    color: COLORS.gold,
    fontSize: 10,
    marginBottom: 4,
    textAlign: 'center',
  },
  modalTitle: {
    ...HHS_TYPOGRAPHY.display,
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  modalSubtitle: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 18,
    textAlign: 'center',
  },
  formError: {
    ...HHS_TYPOGRAPHY.body,
    backgroundColor: 'rgba(232,112,112,0.1)',
    borderColor: 'rgba(232,112,112,0.22)',
    borderRadius: 10,
    borderWidth: 1,
    color: '#e87070',
    fontSize: 13,
    marginBottom: 12,
    padding: 12,
    textAlign: 'center',
  },
  input: {
    ...HHS_TYPOGRAPHY.body,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: COLORS.border,
    borderRadius: 10,
    borderWidth: 1,
    color: COLORS.text,
    fontSize: 15,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  textArea: {
    height: 96,
    paddingTop: 12,
  },
  submitButton: {
    alignItems: 'center',
    backgroundColor: COLORS.gold,
    borderRadius: HHS_STYLES.buttonRadius,
    marginBottom: 10,
    marginTop: 4,
    paddingVertical: 14,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  submitButtonText: {
    ...HHS_TYPOGRAPHY.button,
    color: '#191726',
    fontSize: 14,
    fontWeight: '700',
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  cancelButtonText: {
    ...HHS_TYPOGRAPHY.body,
    color: COLORS.muted,
    fontSize: 14,
  },
});
