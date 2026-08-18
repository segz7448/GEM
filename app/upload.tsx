import { View, Text, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { runBuild } from '@/lib/buildPipeline';

export default function UploadScreen() {
  const router = useRouter();
  const [picked, setPicked] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [starting, setStarting] = useState(false);

  const pickZip = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/zip', 'application/x-zip-compressed'],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    setPicked(result.assets[0]);
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

  return (
    <View className="flex-1 bg-base px-4 pt-4">
      <Pressable
        onPress={pickZip}
        className="border-2 border-dashed border-gray-600 rounded-2xl py-12 items-center mb-6"
      >
        <Text className="text-gray-300 text-base">{picked ? picked.name : 'Tap to choose a project .zip'}</Text>
        {picked && <Text className="text-gray-500 text-sm mt-1">{Math.round((picked.size ?? 0) / 1024)} KB</Text>}
      </Pressable>

      <Pressable
        disabled={!picked || starting}
        onPress={startBuild}
        className={`rounded-2xl py-4 items-center ${picked && !starting ? 'bg-accent' : 'bg-surface'}`}
      >
        {starting ? <ActivityIndicator color="#fff" /> : <Text className="text-white text-lg font-semibold">Start Build</Text>}
      </Pressable>
    </View>
  );
}
