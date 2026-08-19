import type { ProjectFile } from './zipUtils';
import type { ProjectType } from './projectScanner';

export interface ExtractedIcon {
  base64: string;
  mimeType: string;
}

function mimeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

export function extractAppIcon(files: ProjectFile[], type: ProjectType): ExtractedIcon | null {
  // Managed Expo (and bare RN projects that still declare one): app.json's
  // expo.icon points at the source image directly — no need to guess.
  if (type === 'expo-managed' || type === 'react-native') {
    const appJson = files.find((f) => f.path === 'app.json' && f.text);
    if (appJson?.text) {
      try {
        const parsed = JSON.parse(appJson.text);
        const iconPath: string | undefined = parsed?.expo?.icon;
        if (iconPath) {
          const normalized = iconPath.replace(/^\.\//, '');
          const match = files.find((f) => f.path === normalized && f.isBinary && f.base64);
          if (match?.base64) return { base64: match.base64, mimeType: mimeFor(match.path) };
        }
      } catch {
        // Malformed app.json — fall through to the manifest-convention lookup below.
      }
    }
  }

  // Native Android / bare RN (post-prebuild layout): find the launcher
  // icon by Android's own naming convention, preferring the highest
  // density available so history rows aren't stuck with a blurry mdpi icon.
  const densityOrder = ['xxxhdpi', 'xxhdpi', 'xhdpi', 'hdpi', 'mdpi'];
  for (const density of densityOrder) {
    const match = files.find((f) => f.path.includes(`mipmap-${density}`) && /ic_launcher\.(png|webp)$/i.test(f.path) && f.base64);
    if (match?.base64) return { base64: match.base64, mimeType: mimeFor(match.path) };
  }
  const fallback = files.find((f) => /ic_launcher\.(png|webp)$/i.test(f.path) && f.base64);
  if (fallback?.base64) return { base64: fallback.base64, mimeType: mimeFor(fallback.path) };

  return null;
}
