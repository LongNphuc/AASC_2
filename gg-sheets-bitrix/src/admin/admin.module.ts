import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';

/**
 * Admin panel (điểm cộng): ứng dụng Vue 3 + Tailwind trong admin-ui/, build ra
 * public/admin (`npm run admin:build`) và phục vụ tại /admin.
 */
@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public', 'admin'),
      serveRoot: '/admin',
    }),
  ],
})
export class AdminModule {}
