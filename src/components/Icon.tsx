import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** One consistent, crisp vector icon source for app controls and state cues. */
export function Icon({
  name,
  size = 20,
  color = '#A9A6B8',
  ...props
}: {
  name: IconName;
  size?: number;
  color?: ColorValue;
} & Omit<ComponentProps<typeof MaterialCommunityIcons>, 'name' | 'size' | 'color'>) {
  return <MaterialCommunityIcons name={name} size={size} color={color} {...props} />;
}

export function buildStatusIcon(status: string): { name: IconName; color: string } {
  if (status === 'completed') return { name: 'check-circle', color: '#4ADE80' };
  if (status === 'failed') return { name: 'alert-circle', color: '#FB7185' };
  if (status === 'cancelled') return { name: 'close-circle', color: '#8A8798' };
  if (status === 'building' || status === 'compiling') return { name: 'cog-sync-outline', color: '#60A5FA' };
  if (status === 'downloading' || status === 'fetching_artifact') return { name: 'download-circle-outline', color: '#38BDF8' };
  if (status === 'scanning' || status === 'analyzing_project') return { name: 'text-search', color: '#C084FC' };
  if (status === 'uploading' || status === 'pushing_to_build_branch') return { name: 'cloud-upload-outline', color: '#A78BFA' };
  if (status === 'queued') return { name: 'clock-outline', color: '#FBBF24' };
  return { name: 'progress-clock', color: '#A78BFA' };
}
