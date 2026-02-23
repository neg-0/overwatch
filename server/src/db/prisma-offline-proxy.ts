import { randomUUID } from 'crypto';

interface Collection {
  [id: string]: any;
}

class OfflineDB {
  collections: Record<string, Collection> = {};

  private getCollection(model: string) {
    if (!this.collections[model]) this.collections[model] = {};
    return this.collections[model];
  }

  create(model: string, args: any) {
    const coll = this.getCollection(model);
    const id = args.data.id || randomUUID();
    const record = { id, createdAt: new Date(), updatedAt: new Date(), ...args.data };
    coll[id] = record;
    return Promise.resolve(record);
  }

  update(model: string, args: any) {
    const coll = this.getCollection(model);
    let id = args.where.id;
    if (!id) {
      // Find by unique constraint if needed (simplified)
      const keys = Object.keys(args.where);
      const match = Object.values(coll).find((r) => keys.every((k) => r[k] === args.where[k]));
      if (match) id = match.id;
    }
    if (id && coll[id]) {
      coll[id] = { ...coll[id], ...args.data, updatedAt: new Date() };
      return Promise.resolve(coll[id]);
    }
    return Promise.resolve(null);
  }

  updateMany(model: string, args: any) {
    const coll = this.getCollection(model);
    let count = 0;
    Object.values(coll).forEach((record) => {
      let matches = true;
      if (args.where) {
        matches = Object.keys(args.where).every(k => record[k] === args.where[k]);
      }
      if (matches) {
        coll[record.id] = { ...record, ...args.data, updatedAt: new Date() };
        count++;
      }
    });
    return Promise.resolve({ count });
  }

  findUnique(model: string, args: any) {
    const coll = this.getCollection(model);
    let id = args.where.id;
    if (id && coll[id]) return Promise.resolve(coll[id]);

    const keys = Object.keys(args.where || {});
    const match = Object.values(coll).find((r) => keys.every((k) => r[k] === args.where[k]));
    return Promise.resolve(match || null);
  }

  findFirst(model: string, args: any) {
    const coll = this.getCollection(model);
    const keys = Object.keys(args.where || {});
    let values = Object.values(coll).filter((r) => keys.every((k) => {
      if (typeof args.where[k] === 'object' && args.where[k] !== null) {
        // handle simplified nesting like { some: { id } } if needed, skipping for broad mock
        return true;
      }
      return r[k] === args.where[k];
    }));

    if (args.orderBy) {
      const orderKeys = Object.keys(args.orderBy);
      if (orderKeys.length > 0) {
        const key = orderKeys[0];
        const dir = args.orderBy[key];
        values.sort((a, b) => {
          if (a[key] < b[key]) return dir === 'asc' ? -1 : 1;
          if (a[key] > b[key]) return dir === 'asc' ? 1 : -1;
          return 0;
        });
      }
    }
    return Promise.resolve(values[0] || null);
  }

  findMany(model: string, args: any = {}) {
    const coll = this.getCollection(model);
    let values = Object.values(coll);

    if (args.where) {
      const keys = Object.keys(args.where);
      values = values.filter((r) => keys.every((k) => {
        if (args.where[k]?.in) {
          return args.where[k].in.includes(r[k]);
        }
        return r[k] === args.where[k];
      }));
    }

    if (args.orderBy) {
      const orderKeys = Object.keys(args.orderBy);
      if (orderKeys.length > 0) {
        const key = orderKeys[0];
        const dir = args.orderBy[key];
        values.sort((a, b) => {
          if (a[key] < b[key]) return dir === 'asc' ? -1 : 1;
          if (a[key] > b[key]) return dir === 'asc' ? 1 : -1;
          return 0;
        });
      }
    }

    if (args.take) {
      values = values.slice(0, args.take);
    }

    return Promise.resolve(values);
  }

  deleteMany(model: string, args: any) {
    const coll = this.getCollection(model);
    let count = 0;
    if (!args || !args.where) {
      count = Object.keys(coll).length;
      this.collections[model] = {};
    } else {
      const keys = Object.keys(args.where);
      Object.keys(coll).forEach((id) => {
        const record = coll[id];
        const matches = keys.every(k => record[k] === args.where[k]);
        if (matches) {
          delete coll[id];
          count++;
        }
      });
    }
    return Promise.resolve({ count });
  }

  delete(model: string, args: any) {
    const coll = this.getCollection(model);
    if (args.where && args.where.id && coll[args.where.id]) {
      const result = coll[args.where.id];
      delete coll[args.where.id];
      return Promise.resolve(result);
    }
    return Promise.resolve(null);
  }
}

export const offlineDb = new OfflineDB();

export function createOfflineProxy() {
  const handler = {
    get(target: any, modelName: string) {
      // Prisma special properties start with $
      if (modelName.startsWith('$')) {
        if (modelName === '$transaction') {
          return async (queries: Promise<any>[]) => Promise.all(queries);
        }
        if (modelName === '$queryRaw') {
          return async () => [];
        }
        return undefined;
      }

      // Return a mocked model delegate
      return {
        create: (args: any) => offlineDb.create(modelName, args),
        update: (args: any) => offlineDb.update(modelName, args),
        updateMany: (args: any) => offlineDb.updateMany(modelName, args),
        findUnique: (args: any) => offlineDb.findUnique(modelName, args),
        findUniqueOrThrow: async (args: any) => {
          const res = await offlineDb.findUnique(modelName, args);
          if (!res) throw new Error(`Record not found in offline mock for ${modelName}`);
          return res;
        },
        findFirst: (args: any) => offlineDb.findFirst(modelName, args),
        findMany: (args: any) => offlineDb.findMany(modelName, args),
        delete: (args: any) => offlineDb.delete(modelName, args),
        deleteMany: (args: any) => offlineDb.deleteMany(modelName, args),
        count: async (args: any) => {
          const res = await offlineDb.findMany(modelName, args);
          return res.length;
        },
        aggregate: async () => ({ _max: {}, _min: {}, _avg: {} }), // Stub
      };
    }
  };
  return new Proxy({}, handler);
}
