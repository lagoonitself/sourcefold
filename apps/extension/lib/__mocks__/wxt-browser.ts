const storageMap = new Map<string, any>();

export const browser = {
  storage: {
    local: {
      async get(keys: string | string[]) {
        const keyList = Array.isArray(keys) ? keys : [keys];
        const res: Record<string, any> = {};
        for (const k of keyList) {
          if (storageMap.has(k)) {
            res[k] = storageMap.get(k);
          }
        }
        return res;
      },
      async set(items: Record<string, any>) {
        for (const [k, v] of Object.entries(items)) {
          storageMap.set(k, v);
        }
      },
      async remove(keys: string | string[]) {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) {
          storageMap.delete(k);
        }
      },
      async clear() {
        storageMap.clear();
      },
    },
  },
  runtime: {
    id: "sourcefold-test-extension-id",
    async sendNativeMessage(_host: string, _message: any) {
      throw new Error("No native host connected");
    },
    openOptionsPage() {},
    onMessage: {
      addListener(_listener: unknown) {},
    },
    async sendMessage(_message: unknown) {
      throw new Error("No background in tests");
    },
  },
  permissions: {
    async contains(_perms: any) {
      return true;
    },
    async request(_perms: any) {
      return true;
    },
  },
  tabs: {
    async query() {
      return [{ id: 1, title: "Test Page", url: "https://example.com" }];
    },
  },
};
