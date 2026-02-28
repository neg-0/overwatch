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
      const matches = args.where ? this.matchesWhere(record, args.where) : true;
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

  private matchesWhere(record: any, where: any): boolean {
    return Object.keys(where).every((k) => {
      const val = where[k];
      if (val === null || val === undefined) {
        return record[k] == null;
      }
      if (typeof val === 'object' && !Array.isArray(val)) {
        // Handle Prisma operators: { in: [...] }, { not: ... }, { gte: ... }, etc.
        if ('in' in val) return val.in.includes(record[k]);
        if ('not' in val) return record[k] !== val.not;
        if ('gte' in val) return record[k] >= val.gte;
        if ('lte' in val) return record[k] <= val.lte;
        if ('gt' in val) return record[k] > val.gt;
        if ('lt' in val) return record[k] < val.lt;
        // Nested relation filter (e.g., { package: { taskingOrder: { scenarioId: X } } })
        // In offline mode, we can't traverse relations — log warning and skip filter
        console.warn(`[offline-proxy] Nested where clause on '${k}' cannot be evaluated — filter skipped`);
        return true;
      }
      return record[k] === val;
    });
  }

  findFirst(model: string, args: any) {
    const coll = this.getCollection(model);
    let values = Object.values(coll).filter((r) => {
      if (!args.where) return true;
      return this.matchesWhere(r, args.where);
    });

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
      values = values.filter((r) => this.matchesWhere(r, args.where));
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
      Object.keys(coll).forEach((id) => {
        if (this.matchesWhere(coll[id], args.where)) {
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
          return async (queriesOrFn: Promise<any>[] | ((tx: any) => Promise<any>)) => {
            if (typeof queriesOrFn === 'function') {
              // Interactive transaction (callback form) — pass the proxy itself as the tx client
              // Note: offline mode has no real isolation/rollback, but the callback will execute
              const txProxy = new Proxy({}, handler);
              return queriesOrFn(txProxy);
            }
            // Array form — run sequentially to preserve ordering semantics
            const results: any[] = [];
            for (const query of queriesOrFn) {
              results.push(await query);
            }
            return results;
          };
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
        aggregate: async (args: any) => {
          // Build a meaningful aggregate from in-memory data
          const records = await offlineDb.findMany(modelName, { where: args?.where });
          const result: Record<string, any> = { _count: records.length };
          for (const op of ['_max', '_min', '_avg', '_sum'] as const) {
            if (args?.[op]) {
              result[op] = {};
              for (const field of Object.keys(args[op])) {
                const values = records.map((r: any) => r[field]).filter((v: any) => typeof v === 'number');
                if (values.length === 0) { result[op][field] = null; continue; }
                if (op === '_max') result[op][field] = Math.max(...values);
                else if (op === '_min') result[op][field] = Math.min(...values);
                else if (op === '_avg') result[op][field] = values.reduce((a: number, b: number) => a + b, 0) / values.length;
                else if (op === '_sum') result[op][field] = values.reduce((a: number, b: number) => a + b, 0);
              }
            }
          }
          return result;
        },
        createMany: async (args: any) => {
          let count = 0;
          for (const item of (args.data || [])) {
            await offlineDb.create(modelName, { data: item });
            count++;
          }
          return { count };
        },
      };
    }
  };
  return new Proxy({}, handler);
}
