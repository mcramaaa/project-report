'use client';

import { ApiError, responseError } from './api';

/**
 * Multipart POST to the API with upload progress. fetch() cannot report upload progress, so this uses XMLHttpRequest.
 * `onProgress` receives a fraction from 0 to 1 while the request body is being sent.
 */
export function uploadForm<T = void>(
  path: string,
  form: FormData,
  onProgress?: (fraction: number) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new ApiError(0, 'Tidak dapat terhubung ke server.'));
    xhr.onabort = () => reject(new ApiError(0, 'Unggahan dibatalkan.'));
    xhr.onload = () => {
      let data: unknown;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        data = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve(data as T);
      } else {
        reject(responseError(path, xhr.status, data));
      }
    };
    xhr.send(form);
  });
}
