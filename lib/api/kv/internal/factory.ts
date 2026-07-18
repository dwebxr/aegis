import { getRawKV } from "./raw";

interface SetOptions {
  nx?: boolean;
  ex?: number;
}

interface IncrementOptions {
  ex?: number;
}

interface SortedSetMember<T> {
  score: number;
  member: T;
}

type SortedSetRangeOptions = Record<string, unknown>;

function createNamespace(prefix: string) {
  const fullKey = (key: string) => `${prefix}${key}`;

  return {
    async get<T>(key: string): Promise<T | null | undefined> {
      const store = await getRawKV();
      if (!store) return undefined;
      return store.get<T>(fullKey(key));
    },

    async set(key: string, value: unknown, options?: SetOptions): Promise<"OK" | null | undefined> {
      const store = await getRawKV();
      if (!store) return undefined;

      // Undefined is reserved for test cleanup of a namespaced key. It keeps
      // deletion out of the production facade while preserving legacy resets.
      if (value === undefined) {
        await store.del(fullKey(key));
        return "OK";
      }
      let result: unknown;
      if (options?.nx && options.ex !== undefined) {
        result = await store.set(fullKey(key), value, { nx: true, ex: options.ex });
      } else if (options?.nx) {
        result = await store.set(fullKey(key), value, { nx: true });
      } else if (options?.ex !== undefined) {
        result = await store.set(fullKey(key), value, { ex: options.ex });
      } else {
        result = await store.set(fullKey(key), value);
      }
      return result === null ? null : "OK";
    },

    async incr(key: string, options?: IncrementOptions): Promise<number | undefined> {
      const store = await getRawKV();
      if (!store) return undefined;
      const namespacedKey = fullKey(key);
      const count = await store.incr(namespacedKey);
      if (count === 1 && options?.ex !== undefined) await store.expire(namespacedKey, options.ex);
      return count;
    },

    async decr(key: string): Promise<number | undefined> {
      const store = await getRawKV();
      if (!store) return undefined;
      return store.decr(fullKey(key));
    },

    async mget<T extends unknown[]>(...keys: string[]): Promise<T | undefined> {
      const store = await getRawKV();
      if (!store) return undefined;
      return store.mget<T>(...keys.map(fullKey));
    },

    async zadd<T>(key: string, ...members: SortedSetMember<T>[]): Promise<number | null | undefined> {
      const store = await getRawKV();
      if (!store) return undefined;
      const add = store.zadd as unknown as (
        namespacedKey: string,
        ...scoreMembers: SortedSetMember<T>[]
      ) => Promise<number | null>;
      return add(fullKey(key), ...members);
    },

    async zrange<T extends unknown[]>(
      key: string,
      min: number | string,
      max: number | string,
      options?: SortedSetRangeOptions,
    ): Promise<T | undefined> {
      const store = await getRawKV();
      if (!store) return undefined;
      const range = store.zrange as unknown as (
        namespacedKey: string,
        rangeMin: number | string,
        rangeMax: number | string,
        rangeOptions?: SortedSetRangeOptions,
      ) => Promise<T>;
      return range(fullKey(key), min, max, options);
    },

    async zremrangebyrank(key: string, start: number, stop: number): Promise<number | undefined> {
      const store = await getRawKV();
      if (!store) return undefined;
      return store.zremrangebyrank(fullKey(key), start, stop);
    },

    async zrem<T>(key: string, ...members: T[]): Promise<number | undefined> {
      const store = await getRawKV();
      if (!store) return undefined;
      return store.zrem(fullKey(key), ...members);
    },

    async ttl(key: string): Promise<number | undefined> {
      const store = await getRawKV();
      if (!store) return undefined;
      return store.ttl(fullKey(key));
    },
  };
}

type Namespace = ReturnType<typeof createNamespace>;

interface DeleteCapability {
  del(key: string): Promise<number | undefined>;
}

export function kvNamespace(prefix: string): Namespace;
export function kvNamespace(
  prefix: string,
  options: { allowDelete: true },
): Namespace & DeleteCapability;
export function kvNamespace(
  prefix: string,
  options?: { allowDelete?: boolean },
): Namespace | (Namespace & DeleteCapability) {
  const namespace = createNamespace(prefix);
  if (!options?.allowDelete) return namespace;

  return {
    ...namespace,
    async del(key: string): Promise<number | undefined> {
      const store = await getRawKV();
      if (!store) return undefined;
      return store.del(`${prefix}${key}`);
    },
  };
}
