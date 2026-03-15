import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7 requires explicit env loading
import 'dotenv/config';

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  migrate: {
    schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  },
});
