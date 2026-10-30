import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { getBuildTargetDraft, saveBuildTarget, type BuildTarget } from '@/lib/buildTarget';
import { getGithubToken, saveGithubToken, clearGithubToken, testGithubToken } from '@/lib/githubToken';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as Clipboard from 'expo-clipboard';
import { AiProvider, getProviderConfig, saveProviderConfig, deleteProviderConfig, testConnection } from '@/lib/aiSettings';
import { clearHistory, listBuilds } from '@/lib/db';
import { registerForPushNotificationsAsync, getStoredPushToken } from '@/lib/push';
import { setRepoSecret } from '@/lib/githubSecrets';
import { Icon } from '@/components/Icon';

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
    <View className="bg-surface border border-line rounded-2xl p-4 mb-4">
      <View className="flex-row items-center mb-3"><Icon name={id === 'claude' ? 'creation' : id === 'openai' ? 'atom-variant' : id === 'openrouter' ? 'vector-polyline' : 'cloud-outline'} size={18} color="#A78BFA" style={{ marginRight: 7 }} /><Text className="text-white font-semibold">{label}</Text></View>
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
          <View className="flex-row items-center"><Icon name="content-save-outline" size={16} color="#fff" style={{ marginRight: 6 }} /><Text className="text-white font-medium">Save</Text></View>
        </Pressable>
        <Pressable onPress={test} disabled={!apiKey || testing} className="bg-base border border-gray-600 rounded-xl px-4 py-2">
          {testing ? <ActivityIndicator size="small" color="#fff" /> : <View className="flex-row items-center"><Icon name="connection" size={16} color="#fff" style={{ marginRight: 6 }} /><Text className="text-white">Test</Text></View>}
        </Pressable>
      </View>
      {result && <View className="flex-row items-center mt-2"><Icon name={/saved|cleared|connected/i.test(result) ? 'check-circle-outline' : 'alert-circle-outline'} size={16} color={/saved|cleared|connected/i.test(result) ? '#4ADE80' : '#FBBF24'} style={{ marginRight: 6 }} /><Text className="text-gray-400 text-sm flex-1">{result}</Text></View>}
    </View>
  );
}

function GithubTokenRow() {
  const [token, setToken] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    getGithubToken().then(setToken);
  }, []);

  const save = async () => {
    if (!token.trim()) {
      await clearGithubToken();
      setResult('Cleared.');
      return;
    }
    try {
      await saveGithubToken(token);
      setResult('Saved on this device.');
    } catch (err: any) {
      setResult(err?.message ?? 'Could not save the token.');
    }
  };

  const test = async () => {
    if (!token.trim()) return;
    setTesting(true);
    setResult(null);
    const res = await testGithubToken(token);
    setResult(res.message);
    setTesting(false);
  };

  return (
    <View className="bg-surface border border-line rounded-2xl p-4 mb-4">
      <Text className="text-gray-400 text-sm mb-3">
        Builds, artifact downloads and repo secrets all authenticate with this token. It is stored only in this
        phone's secure storage - never in the repository, where GitHub's scanner would revoke it. Use a token with
        repo and workflow access (or a fine-grained token with Contents, Actions and Secrets read/write on the build
        repo).
      </Text>
      <TextInput
        placeholder="GitHub personal access token"
        placeholderTextColor="#666"
        value={token}
        onChangeText={setToken}
        secureTextEntry
        autoCapitalize="none"
        className="bg-base text-white rounded-xl px-3 py-2 mb-3"
      />
      <View className="flex-row items-center">
        <Pressable onPress={save} className="bg-accent rounded-xl px-4 py-2 mr-3">
          <View className="flex-row items-center"><Icon name="content-save-outline" size={16} color="#fff" style={{ marginRight: 6 }} /><Text className="text-white font-medium">Save</Text></View>
        </Pressable>
        <Pressable onPress={test} disabled={!token.trim() || testing} className="bg-base border border-gray-600 rounded-xl px-4 py-2">
          {testing ? <ActivityIndicator size="small" color="#fff" /> : <View className="flex-row items-center"><Icon name="connection" size={16} color="#fff" style={{ marginRight: 6 }} /><Text className="text-white">Test</Text></View>}
        </Pressable>
      </View>
      {result && <View className="flex-row items-center mt-2"><Icon name={/saved|cleared|connected/i.test(result) ? 'check-circle-outline' : 'alert-circle-outline'} size={16} color={/saved|cleared|connected/i.test(result) ? '#4ADE80' : '#FBBF24'} style={{ marginRight: 6 }} /><Text className="text-gray-400 text-sm flex-1">{result}</Text></View>}
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const [storageInfo, setStorageInfo] = useState<{ count: number; totalMb: number } | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [pushLoading, setPushLoading] = useState(false);
  const [sendingToken, setSendingToken] = useState(false);
  const [buildTarget, setBuildTarget] = useState<BuildTarget>({ owner: '', repo: '', branch: 'main' });
  const [savingTarget, setSavingTarget] = useState(false);

  const loadStorage = async () => {
    const builds = await listBuilds();
    const totalBytes = builds.reduce((sum, b) => sum + (b.apkSizeBytes ?? 0), 0);
    setStorageInfo({ count: builds.length, totalMb: Math.round(totalBytes / 1024 / 1024) });
  };

  useEffect(() => {
    loadStorage();
    getStoredPushToken().then(setPushToken);
    getBuildTargetDraft().then(setBuildTarget).catch(() => undefined);
  }, []);

  const saveTarget = async () => {
    setSavingTarget(true);
    try {
      await saveBuildTarget(buildTarget);
      Alert.alert('Build target saved', `${buildTarget.owner}/${buildTarget.repo} · ${buildTarget.branch}`);
    } catch (err: any) {
      Alert.alert('Could not save build target', err.message ?? 'Check the repository details.');
    } finally {
      setSavingTarget(false);
    }
  };

  const refreshPushToken = async () => {
    setPushLoading(true);
    setPushStatus(null);
    const token = await registerForPushNotificationsAsync();
    setPushLoading(false);
    if (token) {
      setPushToken(token);
      setPushStatus('Token ready — copy it below into your repo\u2019s FCM_DEVICE_TOKEN secret.');
    } else {
      setPushToken(null);
      setPushStatus(
        'Couldn\u2019t get a token. Make sure google-services.json is bundled into this build and notification permission is granted.',
      );
    }
  };

  const copyPushToken = async () => {
    if (!pushToken) return;
    await Clipboard.setStringAsync(pushToken);
    setPushStatus('Copied to clipboard.');
  };

  const sendPushTokenToRepo = async () => {
    if (!pushToken) return;
    setSendingToken(true);
    try {
      await setRepoSecret('FCM_DEVICE_TOKEN', pushToken);
      setPushStatus('Sent \u2014 FCM_DEVICE_TOKEN is set on the repo. No copy-paste needed.');
    } catch (err: any) {
      setPushStatus(`Couldn\u2019t set the secret automatically: ${err.message ?? 'unknown error'}. You can still copy it above.`);
    } finally {
      setSendingToken(false);
    }
  };

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
    <ScrollView className="flex-1 bg-base px-5 pt-5">
      <View className="flex-row items-center mb-1"><View className="w-11 h-11 rounded-2xl bg-accent/20 items-center justify-center mr-3"><Icon name="tune-variant" size={22} color="#B6A7FF" /></View><View><Text className="text-white text-xl font-bold">Settings</Text><Text className="text-gray-500 text-xs mt-0.5">Build access, alerts and storage</Text></View></View>
      <View className="flex-row items-center mt-6 mb-3"><Icon name="key-outline" size={20} color="#A78BFA" style={{ marginRight: 8 }} /><Text className="text-white text-lg font-semibold">GitHub Token</Text></View>
      <GithubTokenRow />

      <View className="flex-row items-center mt-6 mb-3"><Icon name="source-repository" size={20} color="#A78BFA" style={{ marginRight: 8 }} /><Text className="text-white text-lg font-semibold">GitHub Build Target</Text></View>
      <View className="bg-surface border border-line rounded-2xl p-4 mb-4">
        <Text className="text-gray-400 text-sm mb-3">GEM can build in this repository or another repository. Uploaded project files and temporary branches are public if this repo is public; you'll confirm before each public build. The repo needs a base branch and GitHub Actions enabled.</Text>
        <TextInput placeholder="GitHub owner or organization" placeholderTextColor="#666" value={buildTarget.owner} onChangeText={(owner) => setBuildTarget((v) => ({ ...v, owner }))} autoCapitalize="none" className="bg-base text-white rounded-xl px-3 py-2 mb-2" />
        <TextInput placeholder="GitHub repository name" placeholderTextColor="#666" value={buildTarget.repo} onChangeText={(repo) => setBuildTarget((v) => ({ ...v, repo }))} autoCapitalize="none" className="bg-base text-white rounded-xl px-3 py-2 mb-2" />
        <TextInput placeholder="Base branch (main)" placeholderTextColor="#666" value={buildTarget.branch} onChangeText={(branch) => setBuildTarget((v) => ({ ...v, branch }))} autoCapitalize="none" className="bg-base text-white rounded-xl px-3 py-2 mb-3" />
        <Pressable onPress={saveTarget} disabled={savingTarget} className="bg-accent rounded-xl px-4 py-3 items-center">
          {savingTarget ? <ActivityIndicator size="small" color="#fff" /> : <View className="flex-row items-center"><Icon name="content-save-outline" size={18} color="#fff" style={{ marginRight: 7 }} /><Text className="text-white font-medium">Save build target</Text></View>}
        </Pressable>
      </View>

      <View className="flex-row items-center mb-3"><Icon name="brain" size={20} color="#A78BFA" style={{ marginRight: 8 }} /><Text className="text-white text-lg font-semibold">AI Settings</Text></View>
      <Text className="text-gray-400 text-sm mb-4">
        Optional — add a key to get AI-written build-failure explanations. Without one, GEM still runs full static
        analysis on failures.
      </Text>
      {PROVIDERS.map((p) => (
        <ProviderRow key={p.id} {...p} />
      ))}

      <View className="flex-row items-center mb-3 mt-2"><Icon name="bell-outline" size={20} color="#A78BFA" style={{ marginRight: 8 }} /><Text className="text-white text-lg font-semibold">Push notifications</Text></View>
      <View className="bg-surface border border-line rounded-2xl p-4 mb-4">
        <Text className="text-gray-400 text-sm mb-3">
          GitHub Actions notifies this device directly via FCM when a build starts, succeeds, or fails - no backend
          involved. This device's token needs to be pasted once into the repo's{' '}
          <Text className="text-gray-300">FCM_DEVICE_TOKEN</Text> secret.
        </Text>
        <Pressable
          onPress={refreshPushToken}
          disabled={pushLoading}
          className="bg-accent rounded-xl px-4 py-3 mb-2 items-center"
        >
          {pushLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-white font-medium">{pushToken ? 'Refresh token' : 'Get device token'}</Text>
          )}
        </Pressable>
        {pushToken && (
          <>
            <View className="bg-base rounded-xl px-3 py-2 mb-2">
              <Text className="text-gray-300 text-xs" numberOfLines={3} selectable>
                {pushToken}
              </Text>
            </View>
            <View className="flex-row">
              <Pressable onPress={copyPushToken} className="flex-1 bg-base border border-gray-600 rounded-xl px-4 py-2 items-center mr-2">
                <View className="flex-row items-center"><Icon name="content-copy" size={16} color="#fff" style={{ marginRight: 6 }} /><Text className="text-white">Copy token</Text></View>
              </Pressable>
              <Pressable
                onPress={sendPushTokenToRepo}
                disabled={sendingToken}
                className="flex-1 bg-accent rounded-xl px-4 py-2 items-center"
              >
                {sendingToken ? <ActivityIndicator size="small" color="#fff" /> : <View className="flex-row items-center"><Icon name="cloud-upload-outline" size={17} color="#fff" style={{ marginRight: 6 }} /><Text className="text-white font-medium">Send to repo</Text></View>}
              </Pressable>
            </View>
          </>
        )}
        {pushStatus && <View className="flex-row items-center mt-2"><Icon name={/couldn.t|get|couldn.t|error/i.test(pushStatus) ? 'alert-circle-outline' : 'check-circle-outline'} size={16} color={/couldn.t|get|error/i.test(pushStatus) ? '#FBBF24' : '#4ADE80'} style={{ marginRight: 6 }} /><Text className="text-gray-400 text-sm flex-1">{pushStatus}</Text></View>}
      </View>

      <View className="flex-row items-center mb-3 mt-2"><Icon name="key-chain-variant" size={20} color="#A78BFA" style={{ marginRight: 8 }} /><Text className="text-white text-lg font-semibold">Repository secrets</Text></View>
      <View className="bg-surface border border-line rounded-2xl p-4 mb-4">
        <Text className="text-gray-400 text-sm mb-3">
          Manage FCM and release-signing secrets directly on GitHub — encrypted on this device before it ever leaves,
          no need to open GitHub's website.
        </Text>
        <Pressable onPress={() => router.push('/secrets')} className="bg-accent rounded-xl px-4 py-3 items-center">
          <View className="flex-row items-center"><Icon name="key-outline" size={18} color="#fff" style={{ marginRight: 7 }} /><Text className="text-white font-medium">Manage secrets</Text><Icon name="chevron-right" size={18} color="#fff" style={{ marginLeft: 5 }} /></View>
        </Pressable>
      </View>

      <View className="flex-row items-center mb-3 mt-2"><Icon name="harddisk" size={20} color="#A78BFA" style={{ marginRight: 8 }} /><Text className="text-white text-lg font-semibold">Storage</Text></View>
      <View className="bg-surface border border-line rounded-2xl p-4 mb-4">
        <Text className="text-gray-300 mb-1">{storageInfo?.count ?? 0} builds in history</Text>
        <Text className="text-gray-300 mb-4">{storageInfo?.totalMb ?? 0} MB of APKs on this device</Text>
        <Pressable onPress={clearAllApks} className="bg-base border border-gray-600 rounded-xl px-4 py-3 mb-2">
          <View className="flex-row items-center"><Icon name="delete-outline" size={18} color="#A9A6B8" style={{ marginRight: 7 }} /><Text className="text-white">Delete all APKs</Text></View>
        </Pressable>
        <Pressable onPress={clearAllHistory} className="bg-base border border-danger rounded-xl px-4 py-3">
          <Text className="text-danger">Clear build history</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
