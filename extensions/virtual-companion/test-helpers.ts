import type { PluginStateEntry, PluginStateKeyedStore } from "openclaw/plugin-sdk/plugin-state-runtime";
import { createCompanionStores, type CompanionStores } from "./state.js";

class MemoryStore<T> implements PluginStateKeyedStore<T> {
  #entries = new Map<string, PluginStateEntry<T>>();

  async register(key: string, value: T): Promise<void> {
    this.#entries.set(key, { key, value, createdAt: Date.now() });
  }

  async registerIfAbsent(key: string, value: T): Promise<boolean> {
    if (this.#entries.has(key)) {
      return false;
    }
    await this.register(key, value);
    return true;
  }

  async lookup(key: string): Promise<T | undefined> {
    return this.#entries.get(key)?.value;
  }

  async consume(key: string): Promise<T | undefined> {
    const value = await this.lookup(key);
    this.#entries.delete(key);
    return value;
  }

  async delete(key: string): Promise<boolean> {
    return this.#entries.delete(key);
  }

  async entries(): Promise<PluginStateEntry<T>[]> {
    return [...this.#entries.values()];
  }

  async clear(): Promise<void> {
    this.#entries.clear();
  }
}

export function createCompanionStoresForTests(): CompanionStores {
  return createCompanionStores(<T>() => new MemoryStore<T>());
}
