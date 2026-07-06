import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { Trace } from '@/constants/theme';

export default function AppTabs() {
  return (
    <NativeTabs
      backgroundColor={Trace.backgroundElement}
      tintColor={Trace.accent}
      labelStyle={{ color: Trace.textSecondary, selected: { color: Trace.accent } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Record</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'record.circle', selected: 'record.circle.fill' }}
          md="radio_button_checked"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="history">
        <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'clock', selected: 'clock.fill' }}
          md="schedule"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
