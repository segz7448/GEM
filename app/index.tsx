import { View, Text, Pressable, FlatList, RefreshControl, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { listBuilds, type LocalBuild } from '@/lib/db';

export default function HomeScreen() {
  const router = useRouter();
  const [builds, setBuilds] = useState<LocalBuild[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const rows = await listBuilds();
    setBuilds(rows.slice(0, 10));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const activeBuild = builds.find((b) => !['completed', 'failed', 'cancelled'].includes(b.status));

  return (
    <View className="flex-1 bg-base px-4 pt-4">
      <Text className="text-white text-2xl font-bold mb-1">GEM</Text>
      <Text className="text-gray-400 mb-6">Build your app for Android, iOS, or Windows.</Text>

      <Pressable
        onPress={() => router.push('/upload')}
        className="bg-accent rounded-2xl py-4 items-center mb-4 active:opacity-80"
      >
        <Text className="text-white text-lg font-semibold">Upload Project</Text>
      </Pressable>

      {activeBuild && (
        <Pressable
          onPress={() => router.push(`/build/${activeBuild.id}`)}
          className="bg-surface rounded-2xl p-4 mb-6 border border-accent/40"
        >
          <Text className="text-accent text-xs uppercase tracking-wide mb-1">In progress</Text>
          <Text className="text-white font-medium">{activeBuild.appName || 'Untitled build'}</Text>
          <Text className="text-gray-400 text-sm mt-1">{activeBuild.stage || activeBuild.status}</Text>
        </Pressable>
      )}

      <View className="flex-row justify-between items-center mb-2">
        <Text className="text-white text-lg font-semibold">Recent Builds</Text>
        <Pressable onPress={() => router.push('/history')}>
          <Text className="text-accent">See all</Text>
        </Pressable>
      </View>

      <FlatList
        data={builds}
        keyExtractor={(b) => b.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/build/${item.id}`)} className="bg-surface rounded-xl p-3 mb-2 flex-row items-center">
            {item.appIconPath ? (
              <Image source={{ uri: item.appIconPath }} style={{ width: 36, height: 36, borderRadius: 8, marginRight: 12 }} />
            ) : (
              <View className="w-9 h-9 rounded-lg bg-base mr-3 items-center justify-center">
                <Text className="text-gray-600">📦</Text>
              </View>
            )}
            <View className="flex-1">
              <Text className="text-white font-medium">{item.appName || 'Untitled build'}</Text>
              <Text className="text-gray-400 text-sm">{item.status} · {new Date(item.createdAt).toLocaleString()}</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={<Text className="text-gray-500">No builds yet — upload a project to get started.</Text>}
      />

      <Pressable onPress={() => router.push('/settings')} className="py-3 items-center">
        <Text className="text-gray-400">Settings</Text>
      </Pressable>
    </View>
  );
}
