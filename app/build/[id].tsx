import { View, Text, ScrollView, Pressable, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { getBuild, type LocalBuild } from '@/lib/db';
import { useBuildStore } from '@/store/buildStore';

const STAGES = [
  'queued',
  'preparing',
  'scanning',
  'generating_workflow',
  'uploading',
  'starting_runner',
  'building',
  'downloading',
  'completed',
];

export default function BuildDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [build, setBuild] = useState<LocalBuild | null>(null);
  const live = useBuildStore((s) => s.live[id]);

  // The pipeline writes to SQLite on every stage change (see buildPipeline.ts),
  // so a short poll here keeps this screen in sync whether the build is
  // running in this session or was resumed by the background task.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const row = await getBuild(id);
      if (!cancelled) setBuild(row);
    };
    tick();
    const interval = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id, live?.stage]);

  if (!build) {
    return (
      <View className="flex-1 bg-base items-center justify-center">
        <Text className="text-gray-500">Loading…</Text>
      </View>
    );
  }

  const currentIndex = STAGES.indexOf(build.stage || build.status);

  const openApk = async () => {
    if (!build.apkLocalPath) return;
    if (Platform.OS === 'android') {
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: build.apkLocalPath,
        flags: 1,
        type: 'application/vnd.android.package-archive',
      }).catch(() => Sharing.shareAsync(build.apkLocalPath!));
    } else {
      await Sharing.shareAsync(build.apkLocalPath);
    }
  };

  const shareApk = async () => {
    if (build.apkLocalPath) await Sharing.shareAsync(build.apkLocalPath);
  };

  return (
    <ScrollView className="flex-1 bg-base px-4 pt-4">
      <Text className="text-white text-xl font-bold mb-1">{build.appName || 'Build'}</Text>
      <Text className="text-gray-400 mb-6">{build.packageName || 'Detecting project type…'}</Text>

      {build.status !== 'failed' && build.status !== 'cancelled' && (
        <View className="mb-6">
          {STAGES.map((stage, i) => (
            <View key={stage} className="flex-row items-center mb-2">
              <View
                className={`w-3 h-3 rounded-full mr-3 ${
                  i < currentIndex ? 'bg-success' : i === currentIndex ? 'bg-accent' : 'bg-gray-700'
                }`}
              />
              <Text className={i <= currentIndex ? 'text-white' : 'text-gray-600'}>{stage.replace(/_/g, ' ')}</Text>
            </View>
          ))}
        </View>
      )}

      {build.status === 'completed' && (
        <View className="bg-surface rounded-2xl p-4 mb-4">
          <Text className="text-success font-semibold mb-2">Build complete</Text>
          <Text className="text-gray-300">Package: {build.packageName ?? 'unknown'}</Text>
          <Text className="text-gray-300">Version: {build.versionName ?? 'unknown'}</Text>
          {build.apkSizeBytes && <Text className="text-gray-300">Size: {Math.round(build.apkSizeBytes / 1024 / 1024)} MB</Text>}
          <View className="flex-row mt-4">
            <Pressable onPress={openApk} className="bg-accent rounded-xl px-4 py-3 mr-3">
              <Text className="text-white font-medium">Open</Text>
            </Pressable>
            <Pressable onPress={shareApk} className="bg-surface border border-gray-600 rounded-xl px-4 py-3">
              <Text className="text-white font-medium">Share</Text>
            </Pressable>
          </View>
        </View>
      )}

      {build.status === 'failed' && (
        <View>
          <Text className="text-danger font-semibold text-lg mb-3">Build failed</Text>
          {(build.failureReport ?? []).map((f, i) => (
            <View key={i} className="bg-surface rounded-2xl p-4 mb-3">
              <Text className="text-white font-medium mb-1">{f.problem}</Text>
              <Text className="text-gray-400 mb-2">{f.rootCause}</Text>
              {f.file && (
                <Text className="text-gray-500 text-sm mb-1">
                  {f.file}
                  {f.line ? `:${f.line}` : ''}
                </Text>
              )}
              {f.suggestedFix && <Text className="text-accent text-sm">{f.suggestedFix}</Text>}
            </View>
          ))}
        </View>
      )}

      {build.scanIssues && build.scanIssues.length > 0 && build.status !== 'failed' && (
        <View className="bg-surface rounded-2xl p-4 mb-4">
          <Text className="text-warn font-medium mb-2">Notices</Text>
          {build.scanIssues.map((issue, i) => (
            <Text key={i} className="text-gray-400 text-sm mb-1">
              • {issue.message}
            </Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
