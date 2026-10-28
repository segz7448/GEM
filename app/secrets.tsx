import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator, RefreshControl } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import {
  listRepoSecrets,
  setRepoSecret,
  deleteRepoSecret,
  encodeFileAsBase64Secret,
  KNOWN_SECRETS,
  type RepoSecretSummary,
} from '@/lib/githubSecrets';
import { Icon } from '@/components/Icon';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function SecretsScreen() {
  const [secrets, setSecrets] = useState<RepoSecretSummary[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const list = await listRepoSecrets();
      setSecrets(list);
    } catch (err: any) {
      setError(err.message ?? 'Could not load secrets.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const setByName = new Map((secrets ?? []).map((s) => [s.name, s]));
  const knownButUnset = KNOWN_SECRETS.filter((k) => !setByName.has(k.name));
  const customSecrets = (secrets ?? []).filter((s) => !KNOWN_SECRETS.some((k) => k.name === s.name));

  return (
    <ScrollView
      className="flex-1 bg-base px-4 pt-4"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
    >
      <View className="flex-row items-center mb-4"><View className="w-11 h-11 rounded-2xl bg-accent/20 items-center justify-center mr-3"><Icon name="key-chain-variant" size={22} color="#B6A7FF" /></View><View><Text className="text-white text-xl font-bold">Repository secrets</Text><Text className="text-gray-500 text-xs mt-0.5">Encrypted on-device before upload</Text></View></View>
      <View className="flex-row items-start bg-surface border border-line rounded-2xl p-4 mb-4"><Icon name="shield-lock-outline" size={19} color="#4ADE80" style={{ marginRight: 8, marginTop: 1 }} /><Text className="text-gray-400 text-sm flex-1">
        Values are encrypted on this device before they're sent — GitHub (and this screen, on reload) can only ever
        show you which secrets exist, never their contents.
      </Text></View>

      {error && (
        <View className="bg-surface border border-line rounded-2xl p-4 mb-4">
          <View className="flex-row items-start"><Icon name="alert-circle-outline" size={18} color="#FB7185" style={{ marginRight: 8 }} /><Text className="text-danger flex-1">{error}</Text></View>
        </View>
      )}

      {secrets === null && !error && (
        <View className="items-center py-8">
          <ActivityIndicator color="#fff" />
        </View>
      )}

      {secrets !== null && (
        <>
          <View className="flex-row items-center mb-3"><Icon name="key-plus" size={19} color="#A78BFA" style={{ marginRight: 8 }} /><Text className="text-white text-lg font-semibold">Set up</Text></View>
          {knownButUnset.length === 0 ? (
            <View className="flex-row items-center mb-4"><Icon name="check-circle-outline" size={18} color="#4ADE80" style={{ marginRight: 7 }} /><Text className="text-gray-500 text-sm">All known secrets are configured.</Text></View>
          ) : (
            knownButUnset.map((k) => <SecretEditor key={k.name} name={k.name} description={k.description} onSaved={load} />)
          )}

          {setByName.size > 0 && (
            <>
              <View className="flex-row items-center mb-3 mt-2"><Icon name="shield-key-outline" size={19} color="#A78BFA" style={{ marginRight: 8 }} /><Text className="text-white text-lg font-semibold">Configured</Text></View>
              {[...KNOWN_SECRETS.filter((k) => setByName.has(k.name)), ...customSecrets.map((s) => ({ name: s.name, description: '' }))].map(
                (item) => {
                  const s = setByName.get(item.name)!;
                  return (
                    <View key={item.name} className="bg-surface border border-line rounded-2xl p-4 mb-3 flex-row items-center justify-between">
                      <View className="flex-1 mr-3">
                        <Text className="text-white font-medium">{item.name}</Text>
                        <Text className="text-gray-500 text-xs mt-1">Updated {formatDate(s.updatedAt)}</Text>
                      </View>
                      <Pressable
                        onPress={() =>
                          Alert.alert('Delete secret', `Remove ${item.name} from the repo?`, [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Delete',
                              style: 'destructive',
                              onPress: async () => {
                                await deleteRepoSecret(item.name);
                                load();
                              },
                            },
                          ])
                        }
                        className="bg-base border border-danger rounded-xl px-3 py-2"
                      >
                        <View className="flex-row items-center"><Icon name="trash-can-outline" size={16} color="#FB7185" style={{ marginRight: 5 }} /><Text className="text-danger text-sm">Delete</Text></View>
                      </Pressable>
                    </View>
                  );
                },
              )}
            </>
          )}

          <View className="flex-row items-center mb-3 mt-2"><Icon name="key-plus" size={19} color="#A78BFA" style={{ marginRight: 8 }} /><Text className="text-white text-lg font-semibold">Add custom secret</Text></View>
          <CustomSecretForm onSaved={load} />
        </>
      )}
    </ScrollView>
  );
}

function SecretEditor({ name, description, onSaved }: { name: string; description: string; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const isKeystore = name === 'RELEASE_KEYSTORE_BASE64';

  const save = async (v: string) => {
    if (!v) return;
    setSaving(true);
    try {
      await setRepoSecret(name, v);
      setValue('');
      onSaved();
    } catch (err: any) {
      Alert.alert('Could not save secret', err.message ?? 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  const pickKeystoreFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled) return;
    setSaving(true);
    try {
      const base64 = await encodeFileAsBase64Secret(result.assets[0].uri);
      await setRepoSecret(name, base64);
      onSaved();
    } catch (err: any) {
      Alert.alert('Could not read/save keystore', err.message ?? 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="bg-surface border border-line rounded-2xl p-4 mb-3">
      <Text className="text-white font-medium mb-1">{name}</Text>
      <Text className="text-gray-500 text-xs mb-3">{description}</Text>
      {isKeystore ? (
        <Pressable onPress={pickKeystoreFile} disabled={saving} className="bg-accent rounded-xl px-4 py-3 items-center">
          {saving ? <ActivityIndicator color="#fff" /> : <View className="flex-row items-center"><Icon name="file-key-outline" size={18} color="#fff" style={{ marginRight: 7 }} /><Text className="text-white font-medium">Pick keystore file (.jks)</Text></View>}
        </Pressable>
      ) : (
        <>
          <TextInput
            placeholder="Value"
            placeholderTextColor="#666"
            value={value}
            onChangeText={setValue}
            secureTextEntry
            autoCapitalize="none"
            className="bg-base text-white rounded-xl px-3 py-2 mb-2"
          />
          <Pressable onPress={() => save(value)} disabled={!value || saving} className="bg-accent rounded-xl px-4 py-3 items-center">
            {saving ? <ActivityIndicator color="#fff" /> : <View className="flex-row items-center"><Icon name="content-save-outline" size={17} color="#fff" style={{ marginRight: 6 }} /><Text className="text-white font-medium">Save</Text></View>}
          </Pressable>
        </>
      )}
    </View>
  );
}

function CustomSecretForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name || !value) return;
    setSaving(true);
    try {
      await setRepoSecret(name.toUpperCase(), value);
      setName('');
      setValue('');
      onSaved();
    } catch (err: any) {
      Alert.alert('Could not save secret', err.message ?? 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="bg-surface border border-line rounded-2xl p-4 mb-6">
      <TextInput
        placeholder="SECRET_NAME"
        placeholderTextColor="#666"
        value={name}
        onChangeText={setName}
        autoCapitalize="characters"
        className="bg-base text-white rounded-xl px-3 py-2 mb-2"
      />
      <TextInput
        placeholder="Value"
        placeholderTextColor="#666"
        value={value}
        onChangeText={setValue}
        secureTextEntry
        autoCapitalize="none"
        className="bg-base text-white rounded-xl px-3 py-2 mb-2"
      />
      <Pressable onPress={save} disabled={!name || !value || saving} className="bg-accent rounded-xl px-4 py-3 items-center">
        {saving ? <ActivityIndicator color="#fff" /> : <View className="flex-row items-center"><Icon name="content-save-outline" size={17} color="#fff" style={{ marginRight: 6 }} /><Text className="text-white font-medium">Save</Text></View>}
      </Pressable>
    </View>
  );
}
