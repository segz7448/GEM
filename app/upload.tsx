import { View, Text, Pressable, ActivityIndicator, Alert, Platform, FlatList } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { runBuild } from '@/lib/buildPipeline';
import { zipPickedFiles, zipPickedDirectory, extractUploadZip, type ProjectFile } from '@/lib/zipUtils';

type PickedSource =
  | { kind: 'zip'; uri: string; name: string; sizeBytes: number }
  | { kind: 'files'; count: number; uri: string; name: string }
  | { kind: 'folder'; uri: string; name: string };

export default function UploadScreen() {
  const router = useRouter();
  const [picked, setPicked] = useState<PickedSource | null>(null);
  const [reviewFiles, setReviewFiles] = useState<ProjectFile[] | null>(null);
  const [preparing, setPreparing] = useState<'zip' | 'files' | 'folder' | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [starting, setStarting] = useState(false);

  // Reads the zip we just built/picked back out into a file list, purely for the
  // review screen — runBuild() below does its own extraction independently, so this
  // is display-only and never blocks or changes what actually gets committed.
  const loadReview = async (source: PickedSource) => {
    setReviewing(true);
    try {
      const files = await extractUploadZip(source.uri);
      setReviewFiles(files);
    } catch (err: any) {
      Alert.alert('Could not read project', err.message ?? 'Something went wrong.');
      setPicked(null);
    } finally {
      setReviewing(false);
    }
  };

  const pickZip = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/zip', 'application/x-zip-compressed'],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const source: PickedSource = { kind: 'zip', uri: asset.uri, name: asset.name, sizeBytes: asset.size ?? 0 };
    setPicked(source);
    await loadReview(source);
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
      const source: PickedSource = { kind: 'files', count: result.assets.length, uri: zipUri, name: zipName };
      setPicked(source);
      setPreparing(null);
      await loadReview(source);
    } catch (err: any) {
      setPreparing(null);
      Alert.alert('Could not read files', err.message ?? 'Something went wrong.');
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
      const source: PickedSource = { kind: 'folder', uri: zipUri, name: `${folderName}.zip` };
      setPicked(source);
      setPreparing(null);
      await loadReview(source);
    } catch (err: any) {
      setPreparing(null);
      Alert.alert('Could not read folder', err.message ?? 'Something went wrong.');
    }
  };

  const reset = () => {
    setPicked(null);
    setReviewFiles(null);
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

  // Once a source is picked, show the review list (matching the "N files ready" screen)
  // instead of the three picker buttons.
  if (picked) {
    return (
      <View className="flex-1 bg-base px-4 pt-4">
        {reviewing ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#fff" />
            <Text className="text-gray-400 mt-3">Reading project files\u2026</Text>
          </View>
        ) : (
          <>
            <Text className="text-gray-300 text-base mb-3">
              {reviewFiles ? `${reviewFiles.length} file${reviewFiles.length === 1 ? '' : 's'} ready to build` : ''}
            </Text>
            <FlatList
              data={reviewFiles ?? []}
              keyExtractor={(item) => item.path}
              className="flex-1 mb-3"
              renderItem={({ item }) => (
                <View className="flex-row items-center py-2 border-b border-gray-800">
                  <Text className="text-gray-200 text-sm" numberOfLines={1}>
                    {item.path}
                  </Text>
                </View>
              )}
            />
            <View className="flex-row gap-3">
              <Pressable onPress={reset} disabled={starting} className="flex-1 border border-gray-600 rounded-2xl py-4 items-center">
                <Text className="text-white">Choose Different Source</Text>
              </Pressable>
              <Pressable onPress={startBuild} disabled={starting} className="flex-1 bg-accent rounded-2xl py-4 items-center">
                {starting ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-semibold">Start Build</Text>}
              </Pressable>
            </View>
          </>
        )}
      </View>
    );
  }

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
    </View>
  );
}
