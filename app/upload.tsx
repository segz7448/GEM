import { View, Text, Pressable, ActivityIndicator, Alert, Platform } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { runBuild } from '@/lib/buildPipeline';
import { zipPickedFiles, zipPickedDirectory } from '@/lib/zipUtils';

type PickedSource =
  | { kind: 'zip'; uri: string; name: string; sizeBytes: number }
  | { kind: 'files'; count: number; uri: string; name: string }
  | { kind: 'folder'; uri: string; name: string };

export default function UploadScreen() {
  const router = useRouter();
  const [picked, setPicked] = useState<PickedSource | null>(null);
  const [preparing, setPreparing] = useState<'zip' | 'files' | 'folder' | null>(null);
  const [starting, setStarting] = useState(false);

  const pickZip = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/zip', 'application/x-zip-compressed'],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setPicked({ kind: 'zip', uri: asset.uri, name: asset.name, sizeBytes: asset.size ?? 0 });
  };

  const pickFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
    if (result.canceled || result.assets.length === 0) return;
    setPreparing('files');
    try {
      const zipName = result.assets.length === 1 ? result.assets[0].name : `project-${result.assets.length}-files.zip`;
      const zipUri = await zipPickedFiles(
        result.assets.map((a) => ({ uri: a.uri, name: a.name })),
        zipName,
      );
      setPicked({ kind: 'files', count: result.assets.length, uri: zipUri, name: zipName });
    } catch (err: any) {
      Alert.alert('Could not read files', err.message ?? 'Something went wrong.');
    } finally {
      setPreparing(null);
    }
  };

  const pickFolder = async () => {
    if (Platform.OS !== 'android') {
      Alert.alert('Not available', 'Folder upload uses Android\u2019s Storage Access Framework and isn\u2019t available on this platform. Use "Choose ZIP File" or "Choose Files" instead.');
      return;
    }
    const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!perm.granted) return;
    setPreparing('folder');
    try {
      const decodedDocId = decodeURIComponent(perm.directoryUri.split('/document/')[1] ?? '');
      const folderName = decodedDocId.split('/').filter(Boolean).pop() || 'project';
      const zipUri = await zipPickedDirectory(perm.directoryUri, folderName);
      setPicked({ kind: 'folder', uri: zipUri, name: `${folderName}.zip` });
    } catch (err: any) {
      Alert.alert('Could not read folder', err.message ?? 'Something went wrong.');
    } finally {
      setPreparing(null);
    }
  };

  const startBuild = async () => {
    if (!picked) return;
    setStarting(true);
    try {
      const buildId = await runBuild(picked.uri, picked.name);
      router.replace(`/build/${buildId}`);
    } catch (err: any) {
      Alert.alert('Could not start build', err.message ?? 'Something went wrong.');
    } finally {
      setStarting(false);
    }
  };

  const anyBusy = preparing !== null || starting;

  return (
    <View className="flex-1 bg-base px-4 pt-4">
      <Pressable
        onPress={pickZip}
        disabled={anyBusy}
        className="bg-accent rounded-2xl py-4 items-center mb-3"
      >
        {preparing === 'zip' ? <ActivityIndicator color="#fff" /> : <Text className="text-white text-base font-semibold">Choose ZIP File</Text>}
      </Pressable>

      <Pressable
        onPress={pickFiles}
        disabled={anyBusy}
        className="border border-gray-600 rounded-2xl py-4 items-center mb-3"
      >
        {preparing === 'files' ? <ActivityIndicator color="#fff" /> : <Text className="text-white text-base">Choose Files</Text>}
      </Pressable>

      <Pressable
        onPress={pickFolder}
        disabled={anyBusy}
        className="border border-gray-600 rounded-2xl py-4 items-center mb-4"
      >
        {preparing === 'folder' ? <ActivityIndicator color="#fff" /> : <Text className="text-white text-base">Choose Folder</Text>}
      </Pressable>

      <Text className="text-gray-500 text-sm text-center mb-6">
        Upload a ZIP archive, pick individual files, or select a whole folder to upload with its structure preserved.
        Nothing is uploaded until you confirm the build below.
      </Text>

      {picked && (
        <View className="bg-surface rounded-2xl px-4 py-3 mb-6">
          <Text className="text-gray-300 text-sm">
            {picked.kind === 'zip' && `${picked.name} \u00b7 ${Math.round(picked.sizeBytes / 1024)} KB`}
            {picked.kind === 'files' && `${picked.count} file${picked.count === 1 ? '' : 's'} ready \u00b7 ${picked.name}`}
            {picked.kind === 'folder' && `Folder ready \u00b7 ${picked.name}`}
          </Text>
        </View>
      )}

      <Pressable
        disabled={!picked || anyBusy}
        onPress={startBuild}
        className={`rounded-2xl py-4 items-center ${picked && !anyBusy ? 'bg-accent' : 'bg-surface'}`}
      >
        {starting ? <ActivityIndicator color="#fff" /> : <Text className="text-white text-lg font-semibold">Start Build</Text>}
      </Pressable>
    </View>
  );
}
