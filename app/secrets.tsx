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
      <Text className="text-gray-400 text-sm mb-4">
        Values are encrypted on this device before they're sent — GitHub (and this screen, on reload) can only ever
        show you which secrets exist, never their contents.
      </Text>

      {error && (
        <View className="bg-surface rounded-2xl p-4 mb-4">
          <Text className="text-danger">{error}</Text>
        </View>
      )}

      {secrets === null && !error && (
        <View className="items-center py-8">
          <ActivityIndicator color="#fff" />
        </View>
      )}

      {secrets !== null && (
        <>
          <Text className="text-white text-lg font-semibold mb-3">Set up</Text>
          {knownButUnset.length === 0 ? (
            <Text className="text-gray-500 text-sm mb-4">All known secrets are configured.</Text>
          ) : (
            knownButUnset.map((k) => <SecretEditor key={k.name} name={k.name} description={k.description} onSaved={load} />)
          )}

          {setByName.size > 0 && (
            <>
              <Text className="text-white text-lg font-semibold mb-3 mt-2">Configured</Text>
              {[...KNOWN_SECRETS.filter((k) => setByName.has(k.name)), ...customSecrets.map((s) => ({ name: s.name, description: '' }))].map(
                (item) => {
                  const s = setByName.get(item.name)!;
                  return (
                    <View key={item.name} className="bg-surface rounded-2xl p-4 mb-3 flex-row items-center justify-between">
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
                        <Text className="text-danger text-sm">Delete</Text>
                      </Pressable>
                    </View>
                  );
                },
              )}
            </>
          )}

          <Text className="text-white text-lg font-semibold mb-3 mt-2">Add custom secret</Text>
          <CustomSecretForm onSaved={load} />
        </>
      )}
    </ScrollView>
  );
}

function SecretEditor({ name, description, onSaved }: { name: string; description: string; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const isKeystore = name === 'ANDROID_KEYSTORE_BASE64';

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
    <View className="bg-surface rounded-2xl p-4 mb-3">
      <Text className="text-white font-medium mb-1">{name}</Text>
      <Text className="text-gray-500 text-xs mb-3">{description}</Text>
      {isKeystore ? (
        <Pressable onPress={pickKeystoreFile} disabled={saving} className="bg-accent rounded-xl px-4 py-3 items-center">
          {saving ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-medium">Pick keystore file (.jks)</Text>}
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
            {saving ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-medium">Save</Text>}
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
    <View className="bg-surface rounded-2xl p-4 mb-6">
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
        {saving ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-medium">Save</Text>}
      </Pressable>
    </View>
  );
}
