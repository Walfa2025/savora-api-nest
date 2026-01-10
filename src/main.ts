import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  // Swagger / OpenAPI
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Savora API')
    .setDescription('Savora backend (api_nest)')
    .setVersion(process.env.npm_package_version ?? '1.0.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  // Optional: export OpenAPI JSON naar bestand
  if (process.env.EXPORT_OPENAPI === '1') {
    const out =
      process.env.EXPORT_OPENAPI_PATH ||
      path.resolve(process.cwd(), 'openapi.json');
    fs.writeFileSync(out, JSON.stringify(document, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(`OpenAPI exported to: ${out}`);
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}
void bootstrap();
