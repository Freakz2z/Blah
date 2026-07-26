/** Minimal ambient types for the Cloudflare runtime globals this worker
 * touches. The full @cloudflare/workers-types package redeclares fetch
 * primitives and clashes with lib.dom in the shared tsconfig, so only the
 * shapes actually used here are declared. */

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
}
