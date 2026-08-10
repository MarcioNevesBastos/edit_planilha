import { strToU8, unzipSync, zipSync } from 'fflate';

export type OoxmlPartContent = ArrayBuffer | Uint8Array | string;

export interface OoxmlPackage {
  listParts(): string[];
  hasPart(path: string): boolean;
  readPart(path: string): Uint8Array;
  updatePart(path: string, content: OoxmlPartContent): void;
  addPart(path: string, content: OoxmlPartContent): void;
  removePart(path: string): void;
  emit(): Promise<ArrayBuffer>;
}

export async function openOoxmlPackage(buffer: ArrayBuffer): Promise<OoxmlPackage> {
  let unzipped: Record<string, Uint8Array>;

  try {
    unzipped = unzipSync(new Uint8Array(buffer));
  } catch (error) {
    throw new Error(
      `Invalid OOXML package: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const parts = new Map(
    Object.entries(unzipped).map(([path, content]) => [path, copyBytes(content)]),
  );

  return {
    listParts: () => [...parts.keys()].sort(),
    hasPart: (path) => parts.has(path),
    readPart: (path) => copyBytes(requirePart(parts, path)),
    updatePart: (path, content) => {
      requirePart(parts, path);
      parts.set(path, partBytes(content));
    },
    addPart: (path, content) => {
      if (parts.has(path)) {
        throw new Error(`OOXML part already exists: ${path}`);
      }
      parts.set(path, partBytes(content));
    },
    removePart: (path) => {
      requirePart(parts, path);
      parts.delete(path);
    },
    emit: async () => {
      const zipped = zipSync(Object.fromEntries(parts), { level: 6 });
      return copyBytes(zipped).buffer;
    },
  };
}

function requirePart(parts: Map<string, Uint8Array>, path: string): Uint8Array {
  const content = parts.get(path);
  if (!content) {
    throw new Error(`OOXML part not found: ${path}`);
  }
  return content;
}

function partBytes(content: OoxmlPartContent): Uint8Array<ArrayBuffer> {
  if (typeof content === 'string') {
    return strToU8(content);
  }
  return copyBytes(content instanceof Uint8Array ? content : new Uint8Array(content));
}

function copyBytes(content: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(content.byteLength);
  copy.set(content);
  return copy;
}
