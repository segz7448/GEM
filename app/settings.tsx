import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system';
import { AiProvider, getProviderConfig, saveProviderConfig, deleteProviderConfig, testConnection } from '@/lib/aiSettings';
import { clearHistory, listBuilds } from '@/lib/db';

const PROVIDERS: { id: AiProvider; label: string; defaultModel: string }[] = [
  { id: 'claude', label: 'Claude', defaultModel: 'claude-sonnet-4-6' },
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4.1' },
  { id: 'openrouter', label: 'OpenRouter', defaultModel: 'qwen/qwen-2.5-coder-32b-instruct' },
  { id: 'huggingface', label: 'Hugging Face', defaultModel: 'deepseek-ai/deepseek-coder-33b-instruct' },
];

function ProviderRow({ id, label, defaultModel }: { id: AiProvider; label: string; defaultModel: string }) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(defaultModel);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    getProviderConfig(id).then((cfg) => {
      if (cfg) {
        setApiKey(cfg.apiKey);
        setModel(cfg.model);
      }
    });
  }, [id]);

  const save = async () => {
    if (!apiKey) {
      await deleteProviderConfig(id);
      setResult('Cleared.');
      return;
    }
    await saveProviderConfig(id, { apiKey, model });
    setResult('Saved.');
  };

  const test = async () => {
    if (!apiKey) return;
    setTesting(true);
    setResult(null);
    const res = await testConnection(id, { apiKey, model });
    setResult(res.message);
    setTesting(false);
  };

  return (
    <View className="bg-surface rounded-2xl p-4 mb-4">
      <Text className="text-white font-semibold mb-3">{label}</Text>
      <TextInput
        placeholder="API key"
        placeholderTextColor="#666"
        value={apiKey}
        onChangeText={setApiKey}
        secureTextEntry
        autoCapitalize="none"
        className="bg-base text-white rounded-xl px-3 py-2 mb-2"
      />
      <TextInput
        placeholder="Model"
        placeholderTextColor="#666"
        value={model}
        onChangeText={setModel}
        autoCapitalize="none"
        className="bg-base text-white rounded-xl px-3 py-2 mb-3"
      />
      <View className="flex-row items-center">
        <Pressable onPress={save} className="bg-accent rounded-xl px-4 py-2 mr-3">
          <Text className="text-white font-medium">Save</Text>
        </Pressable>
        <Pressable onPress={test} disabled={!apiKey || testing} className="bg-base border border-gray-600 rounded-xl px-4 py-2">
          {testing ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-white">Test</Text>}
        </Pressable>
      </View>
      {result && <Text className="text-gray-400 text-sm mt-2">{result}</Text>}
    </View>
  );
}

export default function SettingsScreen() {
  const [storageInfo, setStorageInfo] = useState<{ count: number; totalMb: number } | null>(null);

  const loadStorage = async () => {
    const builds = await listBuilds();
    const totalBytes = builds.reduce((sum, b) => sum + (b.apkSizeBytes ?? 0), 0);
    setStorageInfo({ count: builds.length, totalMb: Math.round(totalBytes / 1024 / 1024) });
  };

  useEffect(() => {
    loadStorage();
  }, []);

  const clearAllApks = () => {
    Alert.alert('Delete all APKs', 'This removes every downloaded APK from this device. Build history stays.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const builds = await listBuilds();
          await Promise.all(
            builds.filter((b) => b.apkLocalPath).map((b) => FileSystem.deleteAsync(b.apkLocalPath!, { idempotent: true })),
          );
          loadStorage();
        },
      },
    ]);
  };

  const clearAllHistory = () => {
    Alert.alert('Clear history', 'This removes all build records. Downloaded APK files are not deleted separately.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => { await clearHistory(); loadStorage(); } },
    ]);
  };

  return (
    <ScrollView className="flex-1 bg-base px-4 pt-4">
      <Text className="text-white text-lg font-semibold mb-3">AI Settings</Text>
      <Text className="text-gray-400 text-sm mb-4">
        Optional — add a key to get AI-written build-failure explanations. Without one, GEM still runs full static
        analysis on failures.
      </Text>
      {PROVIDERS.map((p) => (
        <ProviderRow key={p.id} {...p} />
      ))}

      <Text className="text-white text-lg font-semibold mb-3 mt-2">Storage</Text>
      <View className="bg-surface rounded-2xl p-4 mb-4">
        <Text className="text-gray-300 mb-1">{storageInfo?.count ?? 0} builds in history</Text>
        <Text className="text-gray-300 mb-4">{storageInfo?.totalMb ?? 0} MB of APKs on this device</Text>
        <Pressable onPress={clearAllApks} className="bg-base border border-gray-600 rounded-xl px-4 py-3 mb-2">
          <Text className="text-white">Delete all APKs</Text>
        </Pressable>
        <Pressable onPress={clearAllHistory} className="bg-base border border-danger rounded-xl px-4 py-3">
          <Text className="text-danger">Clear build history</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
