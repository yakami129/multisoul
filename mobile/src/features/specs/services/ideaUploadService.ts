import axios from 'axios';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { getApiClient } from '@/api';

export interface UploadImageResult {
  fileId: string;
}

export class UploadError extends Error {
  constructor(
    message: string,
    public code: 'TOO_LARGE' | 'UNSUPPORTED_TYPE' | 'NETWORK_ERROR' | 'UNKNOWN',
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

/**
 * Compress and upload an image to the server.
 * Tries multiple compression qualities to get under 2MB.
 */
export async function uploadIdeaImage(imageUri: string): Promise<UploadImageResult> {
  const compressedUri = await compressImageToLimit(imageUri, 2 * 1024 * 1024);

  const formData = new FormData();
  const filename = imageUri.split('/').pop() || 'image.jpg';
  const match = /\.(\w+)$/.exec(filename);
  const type = match ? `image/${match[1]}` : 'image/jpeg';

  formData.append('file', {
    uri: compressedUri,
    name: filename,
    type,
  } as never);

  try {
    const response = await getApiClient().post<{ file_id: string }>('/api/v1/uploads', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return { fileId: response.data.file_id };
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response) {
      if (error.response.status === 413) {
        throw new UploadError('Image is too large. Please choose a smaller image.', 'TOO_LARGE');
      }
      if (error.response.status === 415) {
        throw new UploadError('Unsupported image format.', 'UNSUPPORTED_TYPE');
      }
    }
    if (error instanceof Error && error.message.includes('Network')) {
      throw new UploadError('Network error. Please check your connection.', 'NETWORK_ERROR');
    }
    throw new UploadError('Failed to upload image.', 'UNKNOWN');
  } finally {
    await FileSystem.deleteAsync(compressedUri, { idempotent: true });
  }
}

/**
 * Compress image with multiple quality tiers until it's under the size limit.
 */
async function compressImageToLimit(uri: string, maxBytes: number): Promise<string> {
  const qualities = [0.8, 0.6, 0.4];

  for (const quality of qualities) {
    const result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1920 } }], {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });

    const fileInfo = await FileSystem.getInfoAsync(result.uri);
    if ('size' in fileInfo && fileInfo.size && fileInfo.size <= maxBytes) {
      return result.uri;
    }

    if (quality !== qualities[qualities.length - 1]) {
      await FileSystem.deleteAsync(result.uri, { idempotent: true });
    } else {
      return result.uri;
    }
  }

  throw new UploadError(
    'Image is too large even after compression. Please choose a smaller image.',
    'TOO_LARGE',
  );
}
