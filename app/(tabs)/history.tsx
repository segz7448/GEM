import { View, Text, FlatList, Pressable, TextInput, Alert, Image } from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import { listBuilds, deleteBuild, type LocalBuild } from '@/lib/db';
import { Icon, buildStatusIcon } from '@/components/Icon';

function formatDate(value: string): string {
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function HistoryScreen() {
  const router = useRouter();
  const [builds, setBuilds] = useState<LocalBuild[]>([]);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => setBuilds(await listBuilds()), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const filtered = builds.filter((b) => (b.appName ?? '').toLowerCase().includes(query.toLowerCase()));

  const removeBuild = (build: LocalBuild) => {
    Alert.alert('Delete build', `Remove "${build.appName ?? 'this build'}" and its APK from this device?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          if (build.apkLocalPath) await FileSystem.deleteAsync(build.apkLocalPath, { idempotent: true });
          if (build.appIconPath) await FileSystem.deleteAsync(build.appIconPath, { idempotent: true });
          await deleteBuild(build.id);
          load();
        },
      },
    ]);
  };

  return (
    <View className="flex-1 bg-base px-5 pt-5">
      <View className="flex-row items-center justify-between mb-5">
        <View className="flex-row items-center"><View className="w-11 h-11 rounded-2xl bg-accent/20 items-center justify-center mr-3"><Icon name="history" size={22} color="#B6A7FF" /></View><View><Text className="text-white text-xl font-bold">Build history</Text><Text className="text-gray-500 text-xs mt-0.5">{builds.length} saved run{builds.length === 1 ? '' : 's'} on this device</Text></View></View>
        <Pressable onPress={() => router.push('/upload')} className="w-11 h-11 rounded-full bg-accent items-center justify-center"><Icon name="plus" size={23} color="#fff" /></Pressable>
      </View>
      <View className="flex-row items-center bg-surface border border-line rounded-2xl px-3 mb-4">
        <Icon name="magnify" size={21} color="#777487" />
        <TextInput placeholder="Search by project name" placeholderTextColor="#777487" value={query} onChangeText={setQuery} className="flex-1 text-white px-3 py-3.5" returnKeyType="search" />
        {!!query && <Pressable onPress={() => setQuery('')} className="p-1"><Icon name="close-circle" size={18} color="#777487" /></Pressable>}
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(b) => b.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
        renderItem={({ item }) => {
          const status = buildStatusIcon(item.stage || item.status);
          return (
            <Pressable onPress={() => router.push(`/build/${item.id}`)} onLongPress={() => removeBuild(item)} className="bg-surface border border-line rounded-2xl p-3.5 mb-2.5 flex-row items-center active:opacity-80">
              {item.appIconPath ? <Image source={{ uri: item.appIconPath }} style={{ width: 44, height: 44, borderRadius: 13, marginRight: 12 }} /> : <View className="w-11 h-11 rounded-xl bg-base border border-line mr-3 items-center justify-center"><Icon name="application-brackets-outline" size={22} color="#A78BFA" /></View>}
              <View className="flex-1 mr-2"><Text className="text-white font-semibold" numberOfLines={1}>{item.appName || 'Untitled build'}</Text><Text className="text-gray-500 text-xs mt-1">{item.versionName ? `v${item.versionName} · ` : ''}{formatDate(item.createdAt)}</Text>{item.apkSizeBytes ? <Text className="text-gray-500 text-[11px] mt-1">APK · {Math.round(item.apkSizeBytes / 1024 / 1024)} MB</Text> : null}</View>
              <View className="items-center min-w-12"><Icon name={status.name} size={19} color={status.color} /><Text className="text-gray-500 text-[10px] mt-1">{item.status.replace(/_/g, ' ')}</Text></View>
            </Pressable>
          );
        }}
        ListEmptyComponent={<View className="flex-1 items-center justify-center py-14"><View className="w-16 h-16 rounded-2xl bg-surface items-center justify-center mb-3"><Icon name={query ? 'file-search-outline' : 'package-variant-closed'} size={30} color="#777487" /></View><Text className="text-white font-semibold">{query ? 'No matching builds' : 'No builds yet'}</Text><Text className="text-gray-500 text-sm text-center mt-1">{query ? 'Try a different project name.' : 'Your completed and active builds will appear here.'}</Text></View>}
      />
      <View className="flex-row items-center justify-center py-2"><Icon name="gesture-tap-hold" size={15} color="#686575" style={{ marginRight: 6 }} /><Text className="text-gray-600 text-xs">Long-press a build to delete it</Text></View>
    </View>
  );
}
