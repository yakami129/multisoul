import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import mermaidAsset from '../../../../assets/mermaid.min.html';

const mermaidAssetModule = mermaidAsset as number;

let cachedMermaidSource: string | null = null;

export async function loadMermaidSource(): Promise<string> {
  if (cachedMermaidSource) return cachedMermaidSource;

  const asset = Asset.fromModule(mermaidAssetModule);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (uri.startsWith('file://')) {
    cachedMermaidSource = await new File(uri).text();
    return cachedMermaidSource;
  }

  const response = await fetch(uri);
  cachedMermaidSource = await response.text();
  return cachedMermaidSource;
}
