import { Asset } from 'expo-asset';
import mermaidAsset from '../../../../assets/mermaid.min.html';

const mermaidAssetModule = mermaidAsset as number;

let cachedMermaidSource: string | null = null;

export async function loadMermaidSource(): Promise<string> {
  if (cachedMermaidSource) return cachedMermaidSource;

  const asset = Asset.fromModule(mermaidAssetModule);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const response = await fetch(uri);
  cachedMermaidSource = await response.text();
  return cachedMermaidSource;
}
