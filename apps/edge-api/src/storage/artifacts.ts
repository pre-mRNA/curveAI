export interface ObjectStore {
  put(key: string, value: Blob | ArrayBuffer | ArrayBufferView, options?: { contentType?: string }): Promise<string>;
}

export class R2ObjectStore implements ObjectStore {
  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, value: Blob | ArrayBuffer | ArrayBufferView, options?: { contentType?: string }): Promise<string> {
    await this.bucket.put(key, value, {
      httpMetadata: options?.contentType ? { contentType: options.contentType } : undefined,
    });
    return key;
  }
}

export class InMemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();

  async put(key: string, value: Blob | ArrayBuffer | ArrayBufferView, options?: { contentType?: string }): Promise<string> {
    let bytes: Uint8Array;
    if (value instanceof Blob) {
      bytes = new Uint8Array(await value.arrayBuffer());
    } else if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value);
    } else {
      bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    }
    this.objects.set(key, { bytes, contentType: options?.contentType });
    return key;
  }
}
