import { View, Text, FlatList, Pressable, TextInput, Alert, Image } from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import { listBuilds, deleteBuild, type LocalBuild } from '@/lib/db';

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
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (build.apkLocalPath) {
            await FileSystem.deleteAsync(build.apkLocalPath, { idempotent: true });
          }
          if (build.appIconPath) {
            await FileSystem.deleteAsync(build.appIconPath, { idempotent: true });
          }
          await deleteBuild(build.id);
          load();
        },
      },
    ]);
  };

  return (
    <View className="flex-1 bg-base px-4 pt-4">
      <TextInput
        placeholder="Search builds"
        placeholderTextColor="#666"
        value={query}
        onChangeText={setQuery}
        className="bg-surface text-white rounded-xl px-4 py-3 mb-4"
      />
      <FlatList
        data={filtered}
        keyExtractor={(b) => b.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/build/${item.id}`)}
            onLongPress={() => removeBuild(item)}
            className="bg-surface rounded-xl p-3 mb-2 flex-row items-center"
          >
            {item.appIconPath ? (
              <Image source={{ uri: item.appIconPath }} style={{ width: 40, height: 40, borderRadius: 9, marginRight: 12 }} />
            ) : (
              <View className="w-10 h-10 rounded-lg bg-base mr-3 items-center justify-center">
                <Text className="text-gray-600">📦</Text>
              </View>
            )}
            <View className="flex-1">
              <View className="flex-row justify-between">
                <Text className="text-white font-medium">{item.appName || 'Untitled build'}</Text>
                <Text className="text-gray-500 text-xs">{item.status}</Text>
              </View>
              <Text className="text-gray-400 text-sm mt-1">
                {item.versionName ? `v${item.versionName} · ` : ''}
                {new Date(item.createdAt).toLocaleString()}
              </Text>
              {item.apkSizeBytes && (
                <Text className="text-gray-500 text-xs mt-1">{Math.round(item.apkSizeBytes / 1024 / 1024)} MB</Text>
              )}
            </View>
          </Pressable>
        )}
        ListEmptyComponent={<Text className="text-gray-500">No builds match.</Text>}
      />
    </View>
  );
}
