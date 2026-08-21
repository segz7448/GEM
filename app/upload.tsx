import { View, Text, Pressable, ActivityIndicator, Alert, Platform, FlatList } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { runBuild } from '@/lib/buildPipeline';
import {
  zipPickedFiles,
  zipPickedDirectory,
  extractUploadZip,
  checkZipSize,
  findGitignoreContent,
  filterIgnoredEntries,
  type ProjectFile,
} from '@/lib/zipUtils';
import { buildManifest, diffManifests, type ManifestDiff } from '@/lib/buildManifest';
import { getLastCompletedBuildByAppName, type BuildProfile } from '@/lib/db';

type PickedSource =
  | { kind: 'zip'; uri: string; name: string; sizeBytes: number }
  | { kind: 'files'; count: number; uri: string; name: string }
  | { kind: 'folder'; uri: string; name: string };

export default function UploadScreen() {
  const router = useRouter();
  const [picked, setPicked] = useState<PickedSource | null>(null);
  const [reviewFiles, setReviewFiles] = useState<ProjectFile[] | null>(null);
  const [diff, setDiff] = useState<ManifestDiff | null>(null);
  const [hasPreviousBuild, setHasPreviousBuild] = useState(false);
  const [ignoredFiles, setIgnoredFiles] = useState<ProjectFile[]>([]);
  const [ignoredExpanded, setIgnoredExpanded] = useState(false);
  const [profile, setProfile] = useState<BuildProfile>('debug');
  const [preparing, setPreparing] = useState<'zip' | 'files' | 'folder' | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [starting, setStarting] = useState(false);

  // Reads the zip we just built/picked back out into a file list, purely for the
  // review screen — runBuild() below does its own extraction independently, so this
  // is display-only and never blocks or changes what actually gets committed.
  // Also diffs it against the last successful build for the same app name, when one
  // exists, so the review screen can show what actually changed instead of just a
  // flat count every time.
  const loadReview = async (source: PickedSource) => {
    setReviewing(true);
    try {
      const allFiles = await extractUploadZip(source.uri);
      const gitignoreContent = findGitignoreContent(allFiles);
      const { kept, ignored } = filterIgnoredEntries(allFiles, gitignoreContent);
      setReviewFiles(kept);
      setIgnoredFiles(ignored);

      const appNameGuess = source.name.replace(/\.zip$/i, '');
      const [manifest, previousBuild] = await Promise.all([buildManifest(kept), getLastCompletedBuildByAppName(appNameGuess)]);
      setHasPreviousBuild(!!previousBuild);
      setDiff(diffManifests(previousBuild?.fileManifest ?? null, manifest));
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

    // Checked before anything is read into memory — a large zip read as base64
    // roughly triples its footprint, which is what silently OOM-kills the JS
    // engine on low-RAM phones with no error, just an extraction that never
    // finishes. Failing fast here with a clear message beats that every time.
    const { sizeBytes, overHardLimit, overSafeLimit } = await checkZipSize(asset.uri);
    if (overHardLimit) {
      Alert.alert(
        'ZIP too large',
        `This file is ${Math.round(sizeBytes / 1048576)}MB. Files this large can crash the app on many phones because the whole archive has to be held in memory during extraction. Please split it into smaller archives.`,
      );
      return;
    }
    if (overSafeLimit) {
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Large ZIP file',
          `This file is ${Math.round(sizeBytes / 1048576)}MB. Extraction happens in memory, so on phones with limited RAM this may be slow or fail. Continue anyway?`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Continue', onPress: () => resolve(true) },
          ],
        );
      });
      if (!proceed) return;
    }

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
      const { zipUri, possiblyIncomplete } = await zipPickedDirectory(perm.directoryUri, folderName);
      setPreparing(null);

      // A confirmed Android/Expo quirk (expo/expo#20102) can make a subfolder's
      // contents come back as its parent's instead — when that happens the
      // walker stops there rather than duplicating bad data, but it does mean
      // some nested files may be missing. Surface that plainly rather than
      // silently handing over an incomplete project.
      if (possiblyIncomplete) {
        const proceed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            'Some nested files may be missing',
            'Android\u2019s folder picker sometimes can\u2019t reliably read subfolders more than one level deep, so some deeply-nested files may not have been included. If this project has multiple levels of subfolders, zipping it first and using "Choose ZIP File" instead is more reliable. Continue with what was found?',
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Continue anyway', onPress: () => resolve(true) },
            ],
          );
        });
        if (!proceed) return;
      }

      const source: PickedSource = { kind: 'folder', uri: zipUri, name: `${folderName}.zip` };
      setPicked(source);
      await loadReview(source);
    } catch (err: any) {
      setPreparing(null);
      Alert.alert('Could not read folder', `${err.message ?? 'Something went wrong.'}\n\nMake sure you granted folder access when prompted.`);
    }
  };

  const reset = () => {
    setPicked(null);
    setReviewFiles(null);
    setDiff(null);
    setHasPreviousBuild(false);
    setIgnoredFiles([]);
    setIgnoredExpanded(false);
    setProfile('debug');
  };

  const startBuild = async () => {
    if (!picked) return;
    setStarting(true);
    try {
      const buildId = await runBuild(picked.uri, picked.name, profile);
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
            <Text className="text-gray-400 mt-3">{'Reading project files\u2026'}</Text>
          </View>
        ) : (
          <>
            <Text className="text-gray-300 text-base mb-1">
              {reviewFiles ? `${reviewFiles.length} file${reviewFiles.length === 1 ? '' : 's'} ready to build` : ''}
            </Text>
            {diff && hasPreviousBuild && (diff.added.length > 0 || diff.removed.length > 0 || diff.modified.length > 0) && (
              <Text className="text-gray-500 text-xs mb-3">
                {[
                  diff.added.length > 0 ? `${diff.added.length} added` : null,
                  diff.modified.length > 0 ? `${diff.modified.length} changed` : null,
                  diff.removed.length > 0 ? `${diff.removed.length} removed` : null,
                ]
                  .filter(Boolean)
                  .join(' \u00b7 ')}
                {diff.unchangedCount > 0 ? ` \u00b7 ${diff.unchangedCount} unchanged` : ''}
                {' since your last build of this app'}
              </Text>
            )}
            {diff && !hasPreviousBuild && (
              <Text className="text-gray-500 text-xs mb-3">{'First build of this app \u2014 nothing to compare against yet.'}</Text>
            )}

            {ignoredFiles.length > 0 && (
              <Pressable onPress={() => setIgnoredExpanded((v) => !v)} className="mb-3">
                <Text className="text-gray-500 text-xs">
                  {ignoredExpanded ? '\u25be' : '\u25b8'} {ignoredFiles.length} file{ignoredFiles.length === 1 ? '' : 's'} ignored
                  (node_modules, .git, build output, etc.)
                </Text>
                {ignoredExpanded && (
                  <View className="bg-surface rounded-xl p-3 mt-2">
                    {ignoredFiles.slice(0, 50).map((f) => (
                      <Text key={f.path} className="text-gray-600 text-xs mb-1" numberOfLines={1}>
                        {f.path}
                      </Text>
                    ))}
                    {ignoredFiles.length > 50 && (
                      <Text className="text-gray-600 text-xs">{`\u2026 and ${ignoredFiles.length - 50} more`}</Text>
                    )}
                  </View>
                )}
              </Pressable>
            )}

            <View className="flex-row mb-3 bg-surface rounded-xl p-1">
              <Pressable
                onPress={() => setProfile('debug')}
                className={`flex-1 rounded-lg py-2 items-center ${profile === 'debug' ? 'bg-accent' : ''}`}
              >
                <Text className={profile === 'debug' ? 'text-white font-semibold' : 'text-gray-400'}>Debug</Text>
              </Pressable>
              <Pressable
                onPress={() => setProfile('release')}
                className={`flex-1 rounded-lg py-2 items-center ${profile === 'release' ? 'bg-accent' : ''}`}
              >
                <Text className={profile === 'release' ? 'text-white font-semibold' : 'text-gray-400'}>Release</Text>
              </Pressable>
            </View>
            {profile === 'release' && (
              <Text className="text-gray-500 text-xs mb-3">
                Produces a signed APK + AAB if a keystore is set up in Secrets, otherwise an unsigned release build.
              </Text>
            )}

            <FlatList
              data={reviewFiles ?? []}
              keyExtractor={(item) => item.path}
              className="flex-1 mb-3"
              renderItem={({ item }) => {
                const changeTag = diff?.added.includes(item.path) ? 'new' : diff?.modified.includes(item.path) ? 'changed' : null;
                return (
                  <View className="flex-row items-center justify-between py-2 border-b border-gray-800">
                    <Text className="text-gray-200 text-sm flex-1 mr-2" numberOfLines={1}>
                      {item.path}
                    </Text>
                    {changeTag && <Text className="text-accent text-xs">{changeTag}</Text>}
                  </View>
                );
              }}
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
