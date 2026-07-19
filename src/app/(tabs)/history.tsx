import { desc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScalePressable } from '@/components/scale-pressable';
import { BottomTabInset, Trace, TraceFonts } from '@/constants/theme';
import { db } from '@/db/client';
import { activities, type ActivityRow } from '@/db/schema';
import { formatDuration, formatKm, formatPace } from '@/features/recording/geo';
import { composeTitle } from '@/features/recording/places';
import { useRecordingStore } from '@/features/recording/store';

const TYPE_LABEL = { run: 'Run', ride: 'Ride', hike: 'Hike' } as const;

/** M2: reads SQLite via useLiveQuery — updates live as recordings complete. */
export default function HistoryScreen() {
  const { data } = useLiveQuery(
    db
      .select()
      .from(activities)
      .where(eq(activities.status, 'complete'))
      .orderBy(desc(activities.startedAt)),
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        <Text style={styles.subtitle}>Every run&apos;s a doodle.</Text>
      </View>
      <Animated.FlatList
        data={data ?? []}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.list}
        itemLayoutAnimation={LinearTransition.springify().damping(18)}
        renderItem={({ item }) => <ActivityListRow activity={item} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing drawn yet.</Text>
            <Text style={styles.emptyBody}>
              Hit Record and take a walk — your first doodle lands here, and it sticks around now.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function ActivityListRow({ activity }: { activity: ActivityRow }) {
  const router = useRouter();
  const deleteActivity = useRecordingStore((s) => s.deleteActivity);
  const when = new Date(activity.startedAt).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  const confirmDelete = () =>
    Alert.alert('Delete activity?', `${TYPE_LABEL[activity.type]} · ${when} — gone for good.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteActivity(activity.id) },
    ]);
  return (
    <Animated.View entering={FadeIn.duration(250)} exiting={FadeOut.duration(180)}>
      <ScalePressable
        scaleTo={0.97}
        style={styles.row}
        onPress={() => router.push(`/activity/${activity.id}`)}
        onLongPress={confirmDelete}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {composeTitle(activity.startPlace, activity.endPlace) ??
              `${TYPE_LABEL[activity.type]} · ${when}`}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {activity.startPlace || activity.endPlace ? `${TYPE_LABEL[activity.type]} · ${when} · ` : ''}
            {formatKm(activity.distanceM)} km · {formatDuration(activity.durationS)} ·{' '}
            {formatPace(activity.distanceM, activity.durationS)}
          </Text>
        </View>
        <Text style={styles.rowChevron}>›</Text>
      </ScalePressable>
    </Animated.View>
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
  rowChevron: { color: Trace.textMuted, fontFamily: TraceFonts.display, fontSize: 22 },
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
