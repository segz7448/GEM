import { View, Text, ScrollView, Pressable, Platform, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { getBuild, type LocalBuild } from '@/lib/db';
import { retryBuild } from '@/lib/buildPipeline';
import { useBuildStore } from '@/store/buildStore';
import { Icon, buildStatusIcon } from '@/components/Icon';

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
  const router = useRouter();
  const [build, setBuild] = useState<LocalBuild | null>(null);
  const [retrying, setRetrying] = useState(false);
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
        <Icon name="progress-clock" size={32} color="#A78BFA" /><Text className="text-gray-500 mt-3">Loading build…</Text>
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

  const shareAab = async () => {
    if (build.aabLocalPath) await Sharing.shareAsync(build.aabLocalPath);
  };

  const retry = async () => {
    setRetrying(true);
    try {
      const resumed = await retryBuild(build.id);
      if (!resumed) {
        Alert.alert(
          'Can\u2019t retry automatically',
          'This build failed before it reached GitHub, so there\u2019s nothing on the server side to re-run. Please upload the project again.',
          [{ text: 'Upload again', onPress: () => router.replace('/upload') }, { text: 'Cancel', style: 'cancel' }],
        );
      }
      // On success, the pipeline's own SQLite writes will move this screen
      // out of the 'failed' branch on its next 2s poll tick — no local
      // state to flip here beyond clearing the button's own spinner.
    } catch (err: any) {
      Alert.alert('Retry failed', err.message ?? 'Something went wrong.');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-base px-4 pt-4">
      <View className="flex-row items-center mb-1"><View className="w-11 h-11 rounded-xl bg-surface items-center justify-center mr-3"><Icon name={buildStatusIcon(build.stage || build.status).name} size={24} color={buildStatusIcon(build.stage || build.status).color} /></View><View className="flex-1"><Text className="text-white text-xl font-bold">{build.appName || 'Build'}</Text><Text className="text-gray-500 text-xs">{build.status.replace(/_/g, ' ')}</Text></View></View>
      <Text className="text-gray-400 mb-6">{build.packageName || 'Detecting project type…'}</Text>

      {build.status !== 'failed' && build.status !== 'cancelled' && (
        <View className="mb-6">
          {STAGES.map((stage, i) => (
            <View key={stage} className="flex-row items-center mb-2">
              <Icon name={buildStatusIcon(stage).name} size={19} color={i <= currentIndex ? buildStatusIcon(stage).color : '#4B4957'} style={{ marginRight: 10 }} />
              <Text className={i <= currentIndex ? 'text-white' : 'text-gray-600'}>{stage.replace(/_/g, ' ')}</Text>
            </View>
          ))}
        </View>
      )}

      {build.status === 'completed' && (
        <View className="bg-surface rounded-2xl p-4 mb-4">
          <View className="flex-row items-center mb-3"><Icon name="check-circle" size={21} color="#4ADE80" style={{ marginRight: 8 }} /><Text className="text-success font-semibold">APK ready</Text></View>
          <Text className="text-gray-300">Package: {build.packageName ?? 'unknown'}</Text>
          <Text className="text-gray-300">Version: {build.versionName ?? 'unknown'}</Text>
          <Text className="text-gray-300">Profile: {build.buildProfile === 'release' ? 'Release' : 'Debug'}</Text>
          {build.apkSizeBytes && <Text className="text-gray-300">APK size: {Math.round(build.apkSizeBytes / 1024 / 1024)} MB</Text>}
          {build.aabSizeBytes && <Text className="text-gray-300">AAB size: {Math.round(build.aabSizeBytes / 1024 / 1024)} MB</Text>}
          <View className="flex-row mt-4 flex-wrap">
            <Pressable onPress={openApk} className="bg-accent rounded-xl px-4 py-3 mr-3 mb-2">
              <View className="flex-row items-center"><Icon name="open-in-new" size={18} color="#fff" style={{ marginRight: 7 }} /><Text className="text-white font-medium">Open APK</Text></View>
            </Pressable>
            <Pressable onPress={shareApk} className="bg-surface border border-gray-600 rounded-xl px-4 py-3 mr-3 mb-2">
              <View className="flex-row items-center"><Icon name="share-variant-outline" size={18} color="#fff" style={{ marginRight: 7 }} /><Text className="text-white font-medium">Share APK</Text></View>
            </Pressable>
            {build.aabLocalPath && (
              <Pressable onPress={shareAab} className="bg-surface border border-gray-600 rounded-xl px-4 py-3 mb-2">
                <View className="flex-row items-center"><Icon name="share-variant-outline" size={18} color="#fff" style={{ marginRight: 7 }} /><Text className="text-white font-medium">Share AAB</Text></View>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {build.status === 'failed' && (
        <View>
          <View className="flex-row items-center mb-3"><Icon name="alert-circle" size={22} color="#FB7185" style={{ marginRight: 8 }} /><Text className="text-danger font-semibold text-lg">Build failed</Text></View>
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
          <Pressable onPress={retry} disabled={retrying} className="bg-accent rounded-xl px-4 py-3 items-center self-start mb-2">
            {retrying ? <ActivityIndicator color="#fff" /> : <View className="flex-row items-center"><Icon name="refresh" size={18} color="#fff" style={{ marginRight: 7 }} /><Text className="text-white font-medium">Retry build</Text></View>}
          </Pressable>
          <Text className="text-gray-500 text-xs">
            {build.githubRunId
              ? 'Re-runs the same commit on GitHub \u2014 no re-upload needed.'
              : 'This build never reached GitHub, so retrying needs a fresh upload.'}
          </Text>
        </View>
      )}

      {build.scanIssues && build.scanIssues.length > 0 && build.status !== 'failed' && (
        <View className="bg-surface rounded-2xl p-4 mb-4">
          <View className="flex-row items-center mb-2"><Icon name="alert-outline" size={18} color="#FBBF24" style={{ marginRight: 7 }} /><Text className="text-warn font-medium">Notices</Text></View>
          {build.scanIssues.map((issue, i) => (
            <View key={`${issue.file ?? 'issue'}-${i}`} className="flex-row items-start mb-1">
              <Icon name={issue.severity === 'error' ? 'alert-circle-outline' : 'alert-outline'} size={15} color={issue.severity === 'error' ? '#FB7185' : '#FBBF24'} style={{ marginRight: 7, marginTop: 2 }} />
              <Text className="text-gray-400 text-sm flex-1">{issue.message}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
