import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabInset, Trace, TraceFonts } from '@/constants/theme';
import { formatDuration, formatKm, formatPace } from '@/features/recording/geo';
import { useRecordingStore, type CompletedActivity } from '@/features/recording/store';

const TYPE_LABEL = { run: 'Run', ride: 'Ride', walk: 'Walk' } as const;

/** M1: session-only list from the in-memory store. M2 swaps in SQLite + useLiveQuery. */
export default function HistoryScreen() {
  const completed = useRecordingStore((s) => s.completed);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        <Text style={styles.subtitle}>Every run&apos;s a doodle.</Text>
      </View>
      <FlatList
        data={completed}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <ActivityRow activity={item} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing drawn yet.</Text>
            <Text style={styles.emptyBody}>
              Hit Record and take a walk — your first doodle lands here. (Activities live in
              memory until the database ships; closing the app clears them.)
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function ActivityRow({ activity }: { activity: CompletedActivity }) {
  const when = new Date(activity.startedAt).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>
          {TYPE_LABEL[activity.type]} · {when}
        </Text>
        <Text style={styles.rowMeta}>
          {formatKm(activity.distanceM)} km · {formatDuration(activity.durationS)} ·{' '}
          {formatPace(activity.distanceM, activity.durationS)}
        </Text>
      </View>
      <Text style={styles.rowPoints}>{activity.points.length} pts</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Trace.background },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title: { color: Trace.text, fontFamily: TraceFonts.display, fontSize: 34 },
  subtitle: { color: Trace.textSecondary, fontFamily: TraceFonts.body, fontSize: 16 },
  list: { paddingHorizontal: 20, paddingBottom: BottomTabInset + 24, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Trace.backgroundElement,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Trace.border,
    gap: 12,
  },
  rowText: { flex: 1, gap: 3 },
  rowTitle: { color: Trace.text, fontFamily: TraceFonts.displayMedium, fontSize: 15 },
  rowMeta: {
    color: Trace.textSecondary,
    fontFamily: TraceFonts.mono,
    fontSize: 12.5,
    fontVariant: ['tabular-nums'],
  },
  rowPoints: { color: Trace.textMuted, fontFamily: TraceFonts.mono, fontSize: 12 },
  empty: {
    backgroundColor: Trace.backgroundElement,
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: Trace.border,
    gap: 6,
    marginTop: 8,
  },
  emptyTitle: { color: Trace.text, fontFamily: TraceFonts.display, fontSize: 17 },
  emptyBody: {
    color: Trace.textSecondary,
    fontFamily: TraceFonts.body,
    fontSize: 13.5,
    lineHeight: 20,
  },
});
