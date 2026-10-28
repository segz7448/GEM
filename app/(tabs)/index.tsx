import { View, Text, Pressable, FlatList, RefreshControl, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { listBuilds, type LocalBuild } from '@/lib/db';
import { Icon, buildStatusIcon } from '@/components/Icon';

export default function HomeScreen() {
  const router = useRouter();
  const [builds, setBuilds] = useState<LocalBuild[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const rows = await listBuilds();
    setBuilds(rows.slice(0, 12));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const activeBuild = builds.find((b) => !['completed', 'failed', 'cancelled'].includes(b.status));
  const completedCount = builds.filter((b) => b.status === 'completed').length;
  const failedCount = builds.filter((b) => b.status === 'failed').length;

  return (
    <View className="flex-1 bg-base px-5 pt-5">
      <FlatList
        data={builds.slice(0, 5)}
        keyExtractor={(b) => b.id}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor="#B6A7FF" onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListHeaderComponent={
          <>
            <View className="flex-row items-center justify-between mb-6">
              <View className="flex-row items-center">
                <View className="w-12 h-12 rounded-2xl bg-accent/20 border border-accent/40 items-center justify-center mr-3">
                  <Icon name="diamond-stone" size={27} color="#C4B5FD" />
                </View>
                <View>
                  <Text className="text-gray-500 text-xs uppercase tracking-widest">Build studio</Text>
                  <Text className="text-white text-xl font-bold">GEM</Text>
                </View>
              </View>
              <Pressable onPress={() => router.push('/settings')} className="w-11 h-11 rounded-full bg-surface border border-line items-center justify-center">
                <Icon name="cog-outline" size={21} color="#B6A7FF" />
              </Pressable>
            </View>

            <View className="rounded-3xl bg-surface border border-line p-5 mb-5 overflow-hidden">
              <View className="absolute -right-5 -top-7 w-36 h-36 rounded-full bg-accent/10" />
              <Text className="text-violet-200 text-xs font-semibold uppercase tracking-widest mb-2">From source to install</Text>
              <Text className="text-white text-2xl font-bold leading-8 mb-2">Your next APK{ '\n' }starts here.</Text>
              <Text className="text-gray-400 text-sm leading-5 mb-5">Scan a project, build it with GitHub Actions, and bring the APK back to your device.</Text>
              <Pressable onPress={() => router.push('/upload')} className="bg-accent rounded-2xl px-4 py-3.5 flex-row items-center justify-between active:opacity-80">
                <View className="flex-row items-center"><View className="w-9 h-9 rounded-xl bg-white/15 items-center justify-center mr-3"><Icon name="plus" size={22} color="#FFFFFF" /></View><View><Text className="text-white font-semibold">Start a build</Text><Text className="text-violet-100 text-xs mt-0.5">Choose a project ZIP or folder</Text></View></View>
                <Icon name="arrow-right" size={21} color="#FFFFFF" />
              </Pressable>
            </View>

            <View className="flex-row mb-6">
              <View className="flex-1 rounded-2xl bg-surface border border-line p-4 mr-2.5">
                <View className="flex-row items-center mb-2"><Icon name="check-circle-outline" size={17} color="#4ADE80" /><Text className="text-gray-500 text-xs ml-1.5">Ready</Text></View>
                <Text className="text-white text-2xl font-bold">{completedCount}</Text>
                <Text className="text-gray-500 text-xs mt-1">recent builds</Text>
              </View>
              <View className="flex-1 rounded-2xl bg-surface border border-line p-4">
                <View className="flex-row items-center mb-2"><Icon name={activeBuild ? 'progress-clock' : 'clock-outline'} size={17} color={activeBuild ? '#A78BFA' : '#8A8798'} /><Text className="text-gray-500 text-xs ml-1.5">In progress</Text></View>
                <Text className="text-white text-2xl font-bold">{activeBuild ? 1 : 0}</Text>
                <Text className="text-gray-500 text-xs mt-1">{failedCount ? `${failedCount} failed recently` : 'across this device'}</Text>
              </View>
            </View>

            {activeBuild && (
              <Pressable onPress={() => router.push(`/build/${activeBuild.id}`)} className="rounded-2xl bg-surface border border-accent/40 p-4 mb-6">
                <View className="flex-row items-center mb-2"><Icon name="progress-clock" size={17} color="#B6A7FF" style={{ marginRight: 7 }} /><Text className="text-accent text-xs uppercase tracking-widest font-semibold">Build in progress</Text><View className="flex-1" /><Icon name="chevron-right" size={19} color="#777487" /></View>
                <Text className="text-white font-semibold">{activeBuild.appName || 'Untitled build'}</Text>
                <Text className="text-gray-400 text-sm mt-1">{(activeBuild.stage || activeBuild.status).replace(/_/g, ' ')}</Text>
              </Pressable>
            )}

            <View className="flex-row items-center justify-between mb-3">
              <View><Text className="text-white text-lg font-semibold">Recent builds</Text><Text className="text-gray-500 text-xs mt-0.5">Your latest project runs</Text></View>
              <Pressable onPress={() => router.push('/history')} className="flex-row items-center rounded-full bg-surface px-3 py-2"><Text className="text-violet-200 text-xs font-medium">View all</Text><Icon name="chevron-right" size={16} color="#B6A7FF" /></Pressable>
            </View>
          </>
        }
        renderItem={({ item }) => {
          const status = buildStatusIcon(item.stage || item.status);
          return (
            <Pressable onPress={() => router.push(`/build/${item.id}`)} className="bg-surface border border-line rounded-2xl p-3.5 mb-2.5 flex-row items-center active:opacity-80">
              {item.appIconPath ? <Image source={{ uri: item.appIconPath }} style={{ width: 42, height: 42, borderRadius: 12, marginRight: 12 }} /> : <View className="w-11 h-11 rounded-xl bg-base border border-line mr-3 items-center justify-center"><Icon name="application-brackets-outline" size={22} color="#A78BFA" /></View>}
              <View className="flex-1 mr-2"><Text className="text-white font-semibold" numberOfLines={1}>{item.appName || 'Untitled build'}</Text><Text className="text-gray-500 text-xs mt-1">{new Date(item.createdAt).toLocaleString()}</Text></View>
              <View className="items-center min-w-12"><Icon name={status.name} size={19} color={status.color} /><Text className="text-gray-500 text-[10px] mt-1">{item.status.replace(/_/g, ' ')}</Text></View>
            </Pressable>
          );
        }}
        ListEmptyComponent={<View className="items-center rounded-2xl border border-dashed border-line py-9 px-6"><View className="w-14 h-14 rounded-2xl bg-surface items-center justify-center mb-3"><Icon name="package-variant-closed" size={27} color="#777487" /></View><Text className="text-white font-semibold">No builds yet</Text><Text className="text-gray-500 text-sm text-center mt-1">Start with a project ZIP, source folder or selected files.</Text></View>}
        contentContainerStyle={{ paddingBottom: 22 }}
      />
    </View>
  );
}
