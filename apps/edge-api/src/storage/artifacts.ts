export interface ObjectStore {
  put(key: string, value: Blob | ArrayBuffer | ArrayBufferView, options?: { contentType?: string }): Promise<string>;
  get(key: string): Promise<{ blob: Blob; contentType?: string } | undefined>;
  delete(key: string): Promise<void>;
}

export class R2ObjectStore implements ObjectStore {
  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, value: Blob | ArrayBuffer | ArrayBufferView, options?: { contentType?: string }): Promise<string> {
    await this.bucket.put(key, value, {
      httpMetadata: options?.contentType ? { contentType: options.contentType } : undefined,
    });
    return key;
  }

  async get(key: string): Promise<{ blob: Blob; contentType?: string } | undefined> {
    const object = await this.bucket.get(key);
    if (!object) {
      return undefined;
    }
    return {
      blob: await object.blob(),
      contentType: object.httpMetadata?.contentType ?? undefined,
    };
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
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

  async get(key: string): Promise<{ blob: Blob; contentType?: string } | undefined> {
    const object = this.objects.get(key);
    if (!object) {
      return undefined;
    }
    const buffer = Uint8Array.from(object.bytes).buffer;
    return {
      blob: new Blob([buffer], { type: object.contentType }),
      contentType: object.contentType,
    };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
